export default { rules: { "no-console": ["error", { allow: ["warn", "error"] }] } };

// Iteration 2 delta (U000/U052): bigint-only money. A custom ESLint rule is
// heavier than the protection it buys, so this flat-config export bans the
// float-money footgun with no-restricted-globals instead: any parseFloat /
// parseInt / Number() call on balance-like values must go through
// core/formatUnits/parseUnits (bigint). Import and spread alongside the base:
//   import base, { noFloatMoney } from "@drift/eslint-config";
//   export default [...(base.configs ?? []), noFloatMoney];
export const noFloatMoney = {
  rules: {
    "no-restricted-globals": [
      "error",
      {
        name: "parseFloat",
        message: "No parseFloat on money — use core/formatUnits/parseUnits (bigint). Document any exception in THREAT_MODEL.md.",
      },
    ],
    "no-restricted-syntax": [
      "error",
      {
        selector: "CallExpression[callee.name='Number'][arguments.length=1]",
        message: "No Number(balance) — float precision loss. Use parseUnits/formatUnits (bigint).",
      },
    ],
  },
};
