//! Proc-macros for personas-desktop.
//!
//! Currently exports one attribute: `#[requires(level)]` for Tauri commands.
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
