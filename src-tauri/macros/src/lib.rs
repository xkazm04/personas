//! Proc-macros for personas-desktop.
//!
//! Exports the `#[requires(level)]` attribute for Tauri commands and the
//! `ipc_shard!` wrapper used by `src/ipc_shards/`.
//! See `ipc_auth.rs` in the main crate for the underlying guard functions
//! and the `idea-7a4838c1` capability-audit deliverable for context on why
//! this exists.

use proc_macro::TokenStream;
use proc_macro2::Span;
use quote::quote;
use syn::{parse_macro_input, ItemFn, LitStr};

/// `#[requires(level)]` — auth guard for `#[tauri::command]` handlers.
///
/// Expands to a guard call inserted as the first statement of the function
/// body. The command name (`stringify!(fn_name)`) is auto-derived from the
/// function so it stays in sync with the IPC handler registration.
///
/// Levels:
///
/// - `auth` — basic session check. Sync = `require_auth_sync(&state)?`,
///   async = `require_auth(&state).await?`. Currently a no-op but
///   intentionally retained as the future hook for tier/session logic.
/// - `privileged` — IPC session token. Sync =
///   `require_privileged_sync(&state, "<fn_name>")?`, async =
///   `require_privileged(&state, "<fn_name>").await?`.
/// - `cloud` — Google OAuth. Always async:
///   `require_cloud_auth(&state, "<fn_name>").await?`. Applying `#[requires(cloud)]`
///   to a sync `fn` is a compile error.
///
/// Usage:
///
/// ```ignore
/// #[tauri::command]
/// #[requires(auth)]
/// pub fn list_personas(state: State<'_, Arc<AppState>>) -> Result<Vec<Persona>, AppError> {
///     repo::get_all(&state.db)
/// }
///
/// #[tauri::command]
/// #[requires(privileged)]
/// pub fn create_credential(state: State<'_, Arc<AppState>>, input: CreateCredentialInput) -> Result<Credential, AppError> {
///     repo::create(&state.db, input)
/// }
///
/// #[tauri::command]
/// #[requires(cloud)]
/// pub async fn cloud_deploy(state: State<'_, Arc<AppState>>) -> Result<(), AppError> {
///     ...
/// }
/// ```
///
/// The macro looks for a parameter named `state` of any type. If your function
/// uses a different name (e.g. `s` or `app_state`), the expansion will fail to
/// compile with a clear "cannot find value `state`" error — rename the parameter
/// to `state` to fix.
#[proc_macro_attribute]
pub fn requires(attr: TokenStream, item: TokenStream) -> TokenStream {
    let level = parse_macro_input!(attr as syn::Ident);
    let item_fn = parse_macro_input!(item as ItemFn);

    let is_async = item_fn.sig.asyncness.is_some();
    let fn_name = item_fn.sig.ident.to_string();
    let fn_name_lit = LitStr::new(&fn_name, Span::call_site());

    // Build the guard call statement to prepend.
    let guard_stmt = match (level.to_string().as_str(), is_async) {
        ("auth", false) => quote! {
            crate::ipc_auth::require_auth_sync(&state)?;
        },
        ("auth", true) => quote! {
            crate::ipc_auth::require_auth(&state).await?;
        },
        ("privileged", false) => quote! {
            crate::ipc_auth::require_privileged_sync(&state, #fn_name_lit)?;
        },
        ("privileged", true) => quote! {
            crate::ipc_auth::require_privileged(&state, #fn_name_lit).await?;
        },
        ("cloud", true) => quote! {
            crate::ipc_auth::require_cloud_auth(&state, #fn_name_lit).await?;
        },
        ("cloud", false) => {
            return syn::Error::new(
                level.span(),
                "#[requires(cloud)] requires an async fn (require_cloud_auth is async). Either make the fn async, or use #[requires(privileged)] for a sync command.",
            )
            .to_compile_error()
            .into();
        }
        (other, _) => {
            return syn::Error::new(
                level.span(),
                format!(
                    "unknown level `{}`: expected one of `auth`, `privileged`, `cloud`",
                    other
                ),
            )
            .to_compile_error()
            .into();
        }
    };

    // Reassemble the function with the guard prepended to its body.
    let attrs = &item_fn.attrs;
    let vis = &item_fn.vis;
    let sig = &item_fn.sig;
    let block = &item_fn.block;

    let stmts = &block.stmts;
    let output = quote! {
        #(#attrs)*
        #vis #sig {
            #guard_stmt
            #(#stmts)*
        }
    };

    output.into()
}

/// One entry of a handler list: `#[cfg(..)]* path::to::command`.
struct ShardEntry {
    attrs: Vec<syn::Attribute>,
    path: syn::Path,
}

impl syn::parse::Parse for ShardEntry {
    fn parse(input: syn::parse::ParseStream) -> syn::Result<Self> {
        Ok(Self {
            attrs: input.call(syn::Attribute::parse_outer)?,
            path: input.parse()?,
        })
    }
}

/// `ipc_shard!(tauri::generate_handler![ ... ])` — one shard of the IPC surface.
///
/// Expands to a tuple `(owns, run)`:
///
/// - `run` is the wrapped `tauri::generate_handler!` invocation, re-emitted
///   token for token, so Tauri's own macro still builds the dispatch closure.
/// - `owns` is a `fn(&str) -> bool` that is `true` for exactly the wire names in
///   the list, each arm carrying the same `#[cfg(..)]` attributes as its entry.
///
/// Why this exists: Tauri accepts ONE invoke handler, and its macro expands to
/// one closure with a `match` arm per command. rustc's cost for that body is
/// super-linear in the arm count — with ~1,600 commands it was half of a cold
/// `cargo check` of the app crate. Splitting the list into shards fixes the
/// cost, but an `Invoke` is moved into whichever closure receives it, so shards
/// cannot be tried in turn: the router must know who owns a name BEFORE it
/// hands the invoke over. Deriving `owns` from the same token list means a
/// command is registered by ONE edit and the router cannot drift from it.
///
/// The wire name is the path's last segment, which is how
/// `tauri::generate_handler!` names a command too.
#[proc_macro]
pub fn ipc_shard(input: TokenStream) -> TokenStream {
    let inner = parse_macro_input!(input as syn::Macro);
    let is_generate_handler = inner
        .path
        .segments
        .last()
        .is_some_and(|s| s.ident == "generate_handler");
    if !is_generate_handler {
        return syn::Error::new_spanned(
            &inner.path,
            "ipc_shard! wraps exactly one `tauri::generate_handler![...]` invocation",
        )
        .to_compile_error()
        .into();
    }
    let entries = match inner.parse_body_with(
        syn::punctuated::Punctuated::<ShardEntry, syn::Token![,]>::parse_terminated,
    ) {
        Ok(entries) => entries,
        Err(e) => return e.to_compile_error().into(),
    };

    let mut arms = Vec::with_capacity(entries.len());
    for entry in &entries {
        let Some(last) = entry.path.segments.last() else {
            return syn::Error::new_spanned(&entry.path, "empty command path")
                .to_compile_error()
                .into();
        };
        let name = LitStr::new(&last.ident.to_string(), last.ident.span());
        let attrs = &entry.attrs;
        arms.push(quote! { #(#attrs)* #name => true, });
    }

    quote! {
        (
            {
                fn owns(command: &str) -> bool {
                    match command {
                        #(#arms)*
                        _ => false,
                    }
                }
                owns as fn(&str) -> bool
            },
            #inner,
        )
    }
    .into()
}
