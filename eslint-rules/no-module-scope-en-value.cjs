/**
 * ESLint rule: no-module-scope-en-value
 *
 * Flags reading a VALUE out of the English back-compat shim (`en` from
 * `@/i18n/en`) at MODULE SCOPE.
 *
 * ## Why
 *
 * `en` is a lazy Proxy, so `import { en } from '@/i18n/en'` is nearly free and
 * is entirely legal — ~48 modules legitimately need a stable English snapshot.
 * The bug is narrower: a value read at IMPORT time is frozen forever. Module
 * initialization happens once, before the user has picked a language and long
 * before any locale chunk resolves, so the string it captures can never react
 * to a language switch.
 *
 * Proven live instance (2026-08-09), the reason this rule exists:
 *
 *     // src/stores/slices/overview/alertSlice.ts
 *     export const ALERT_METRIC_OPTIONS = [
 *       { value: 'error_rate', label: en.alerts.metric_error_rate, unit: '%' },
 *       …
 *     ];
 *
 * The alert-rules panel rendered `option.label` directly, with no
 * `useTranslation()` anywhere in that data path: frozen English for every user
 * in every locale, and nothing in the i18n tooling could see it (the keys exist,
 * are translated, and ARE referenced — just at the wrong time).
 *
 * ## What is flagged
 *
 * Only member reads of the `en` binding evaluated during module initialization:
 * top-level statements, and initializers of top-level `const`/`let`/`var`,
 * including inside object/array literals and template strings.
 *
 * ## What is NOT flagged
 *
 *   - `import { en } from '@/i18n/en'` on its own.
 *   - Any read inside a function, method, arrow, class method, or getter — those
 *     run at call time and re-read the proxy, so they follow the active bundle
 *     as far as the shim can.
 *   - `typeof en`, and passing `en` itself as a value.
 *   - A file that never imports `en` from the i18n shim (a local variable named
 *     `en` is not the shim).
 *
 * ## The fix
 *
 * Carry the KEY, resolve the value where it renders:
 *
 *     export const OPTIONS = [{ value: 'error_rate', labelKey: 'metric_error_rate' }];
 *     // in the component:
 *     const { t } = useTranslation();
 *     <span>{t.alerts[o.labelKey]}</span>
 *
 * See `.claude/CLAUDE.md` → "Constants with Labels".
 *
 * ## Deliberate exceptions
 *
 * Some module-scope English IS correct: a value persisted to the database, a
 * log line, a Sentry message, a machine-readable default. Those get an inline
 * disable WITH A REASON, never a weakened rule:
 *
 *     // eslint-disable-next-line custom/no-module-scope-en-value -- persisted to SQLite; must be language-stable
 */

const EN_SHIM_SOURCES = new Set(['@/i18n/en', '../i18n/en', './en']);

/** Scopes whose body runs later than module init. */
const DEFERRED_SCOPES = new Set([
  'FunctionDeclaration',
  'FunctionExpression',
  'ArrowFunctionExpression',
  'ClassBody',
  'PropertyDefinition',
  'StaticBlock',
]);

/** @type {import('eslint').Rule.RuleModule} */
module.exports = {
  meta: {
    type: 'problem',
    docs: {
      description:
        'Disallow reading a value from the English i18n shim at module scope — it freezes that string for every locale',
    },
    messages: {
      frozen:
        'Reading `en.{{path}}` at module scope freezes the English string at import time — it can never follow a language switch. ' +
        'Carry the KEY in the constant and resolve it where it renders (useTranslation() in a component, ' +
        'getActiveTranslations() in a non-React module). See .claude/CLAUDE.md "Constants with Labels". ' +
        'If English here is deliberate (persisted value, log line, Sentry message), add ' +
        '`// eslint-disable-next-line custom/no-module-scope-en-value -- <reason>`.',
    },
    schema: [],
  },
  create(context) {
    /** Local name the shim was imported under (usually `en`). */
    let shimLocalName = null;

    function pathOf(node) {
      const parts = [];
      let cur = node;
      while (cur && cur.type === 'MemberExpression' && !cur.computed && cur.property.type === 'Identifier') {
        parts.unshift(cur.property.name);
        cur = cur.object;
      }
      return parts.join('.') || '?';
    }

    /**
     * True when `node` is evaluated during module initialization — i.e. no
     * function/class boundary between it and the Program root.
     */
    function runsAtModuleInit(node) {
      let cur = node.parent;
      while (cur) {
        if (DEFERRED_SCOPES.has(cur.type)) return false;
        if (cur.type === 'Program') return true;
        cur = cur.parent;
      }
      return false;
    }

    return {
      ImportDeclaration(node) {
        const source = typeof node.source.value === 'string' ? node.source.value : '';
        if (!EN_SHIM_SOURCES.has(source) && !/(^|\/)i18n\/en$/.test(source)) return;
        for (const spec of node.specifiers) {
          if (spec.type === 'ImportSpecifier' && spec.imported.name === 'en') {
            shimLocalName = spec.local.name;
          }
        }
      },

      MemberExpression(node) {
        if (!shimLocalName) return;
        // Report the LONGEST chain once: `en.alerts.metric_cost`, not also the
        // `en.alerts` sub-expression inside it. ESLint visits the outermost
        // MemberExpression first, and only that one carries the full path — so
        // skip any node that is itself the object of an enclosing member read.
        if (node.parent && node.parent.type === 'MemberExpression' && node.parent.object === node) return;

        // Descend to the base identifier through however many property reads.
        let root = node;
        while (root.type === 'MemberExpression') root = root.object;
        if (root.type !== 'Identifier' || root.name !== shimLocalName) return;

        // A local shadowing `en` (a parameter, a catch binding) is not the shim.
        const scope = context.sourceCode ? context.sourceCode.getScope(node) : context.getScope();
        const ref = scope.references.find((r) => r.identifier === root);
        if (ref && ref.resolved && ref.resolved.defs.length && ref.resolved.defs[0].type !== 'ImportBinding') {
          return;
        }
        if (!runsAtModuleInit(node)) return;

        context.report({ node, messageId: 'frozen', data: { path: pathOf(node) } });
      },
    };
  },
};
