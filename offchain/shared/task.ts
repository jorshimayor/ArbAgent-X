// A tiny, safe arithmetic evaluator (no eval). Supports + - * / and parentheses
// over integers and decimals. This is the "ground truth" the verifier re-runs to
// decide objectively whether an agent's output was correct — which is what makes
// the slash in the demo crisp and non-subjective.

type Token = { t: "num"; v: number } | { t: "op"; v: string } | { t: "paren"; v: "(" | ")" };

function tokenize(expr: string): Token[] {
  const tokens: Token[] = [];
  let i = 0;
  while (i < expr.length) {
    const c = expr[i];
    if (c === " " || c === "\t") {
      i++;
      continue;
    }
    if ("+-*/".includes(c)) {
      tokens.push({ t: "op", v: c });
      i++;
      continue;
    }
    if (c === "(" || c === ")") {
      tokens.push({ t: "paren", v: c });
      i++;
      continue;
    }
    if (/[0-9.]/.test(c)) {
      let num = "";
      while (i < expr.length && /[0-9.]/.test(expr[i])) num += expr[i++];
      const v = Number(num);
      if (!Number.isFinite(v)) throw new Error(`bad number: ${num}`);
      tokens.push({ t: "num", v });
      continue;
    }
    throw new Error(`unexpected character: ${c}`);
  }
  return tokens;
}

const PREC: Record<string, number> = { "+": 1, "-": 1, "*": 2, "/": 2 };

function toRPN(tokens: Token[]): Token[] {
  const out: Token[] = [];
  const ops: Token[] = [];
  for (const tok of tokens) {
    if (tok.t === "num") out.push(tok);
    else if (tok.t === "op") {
      while (
        ops.length &&
        ops[ops.length - 1].t === "op" &&
        PREC[(ops[ops.length - 1] as any).v] >= PREC[tok.v]
      ) {
        out.push(ops.pop()!);
      }
      ops.push(tok);
    } else if (tok.v === "(") ops.push(tok);
    else {
      while (ops.length && !(ops[ops.length - 1].t === "paren")) out.push(ops.pop()!);
      if (!ops.length) throw new Error("mismatched parentheses");
      ops.pop(); // discard "("
    }
  }
  while (ops.length) {
    const o = ops.pop()!;
    if (o.t === "paren") throw new Error("mismatched parentheses");
    out.push(o);
  }
  return out;
}

/** Deterministically evaluate an arithmetic expression. Throws on malformed input. */
export function evaluate(expr: string): number {
  const rpn = toRPN(tokenize(expr));
  const stack: number[] = [];
  for (const tok of rpn) {
    if (tok.t === "num") stack.push(tok.v);
    else {
      const b = stack.pop();
      const a = stack.pop();
      if (a === undefined || b === undefined) throw new Error("malformed expression");
      switch (tok.v) {
        case "+": stack.push(a + b); break;
        case "-": stack.push(a - b); break;
        case "*": stack.push(a * b); break;
        case "/": stack.push(a / b); break;
      }
    }
  }
  if (stack.length !== 1) throw new Error("malformed expression");
  return stack[0];
}

/** Canonical string form of the answer, used for hashing and comparison. */
export function canonical(n: number): string {
  // Round to 6 dp to avoid float noise, trim trailing zeros.
  return String(Number(n.toFixed(6)));
}
