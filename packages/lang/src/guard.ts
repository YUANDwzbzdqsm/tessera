import { parseExpressionAt } from 'acorn';

/**
 * Globals an expression may read. Everything else must be a declared state, a @let, a loop variable or a parameter.
 * This check is the first line of defence; the SES sandbox in the runtime is the real boundary.
 */
export const ALLOWED_GLOBALS: ReadonlySet<string> = new Set([
  'ui',
  'Math',
  'Number',
  'String',
  'Boolean',
  'Array',
  'Object',
  'JSON',
  'Date',
  'Intl',
  'isNaN',
  'isFinite',
  'parseInt',
  'parseFloat',
  'undefined',
  'NaN',
  'Infinity',
]);

const BLOCKED_MEMBERS = new Set([
  'constructor',
  '__proto__',
  'prototype',
  '__defineGetter__',
  '__defineSetter__',
  '__lookupGetter__',
  '__lookupSetter__',
]);

export interface GuardIssue {
  readonly code: 'invalid_expression' | 'forbidden_syntax' | 'unknown_identifier';
  readonly message: string;
}

export interface GuardResult {
  readonly issues: readonly GuardIssue[];
  /** Set when the expression is a plain literal, so its value can be validated at compile time. */
  readonly literal?: { readonly value: unknown };
}

// acorn's ESTree nodes, loosely typed: the walker only reads the fields it switches on.
type N = { type: string; [key: string]: any };

export function guardExpression(source: string, scope: ReadonlySet<string>): GuardResult {
  let ast: N;
  try {
    ast = parseExpressionAt(source, 0, { ecmaVersion: 2022 }) as unknown as N;
  } catch (e) {
    return { issues: [{ code: 'invalid_expression', message: `Cannot parse {${source}}: ${(e as Error).message}` }] };
  }
  if (source.slice(ast.end).trim() !== '') {
    return { issues: [{ code: 'invalid_expression', message: `Unexpected text after expression in {${source}}` }] };
  }

  const issues: GuardIssue[] = [];
  const scopes: Set<string>[] = [new Set(scope)];
  const known = (name: string) => ALLOWED_GLOBALS.has(name) || scopes.some((s) => s.has(name));
  const forbid = (what: string) => issues.push({ code: 'forbidden_syntax', message: `${what} is not allowed in {${source}}` });

  const expr = (node: N | null | undefined): void => {
    if (!node) return;
    switch (node.type) {
      case 'Identifier':
        if (node.name.startsWith('__')) forbid(`The name ${node.name}`);
        else if (!known(node.name)) issues.push({ code: 'unknown_identifier', message: `Unknown name ${node.name} in {${source}}` });
        return;
      case 'Literal':
        return;
      case 'TemplateLiteral':
        node.expressions.forEach(expr);
        return;
      case 'ArrayExpression':
        node.elements.forEach(expr);
        return;
      case 'ObjectExpression':
        for (const p of node.properties) {
          if (p.type === 'SpreadElement') {
            expr(p.argument);
            continue;
          }
          if (p.kind !== 'init' || p.method) {
            forbid('Getters, setters and methods in object literals');
            continue;
          }
          if (p.computed) expr(p.key);
          else if (BLOCKED_MEMBERS.has(p.key.name ?? p.key.value)) forbid(`The key ${p.key.name ?? p.key.value}`);
          expr(p.value);
        }
        return;
      case 'SpreadElement':
        expr(node.argument);
        return;
      case 'UnaryExpression':
        if (node.operator === 'delete') forbid('delete');
        expr(node.argument);
        return;
      case 'BinaryExpression':
      case 'LogicalExpression':
        expr(node.left);
        expr(node.right);
        return;
      case 'ConditionalExpression':
        expr(node.test);
        expr(node.consequent);
        expr(node.alternate);
        return;
      case 'CallExpression':
        expr(node.callee);
        node.arguments.forEach(expr);
        return;
      case 'MemberExpression':
        expr(node.object);
        if (node.computed) {
          if (node.property.type === 'Literal' && BLOCKED_MEMBERS.has(String(node.property.value))) forbid(`Accessing ${node.property.value}`);
          expr(node.property);
        } else if (BLOCKED_MEMBERS.has(node.property.name)) {
          forbid(`Accessing ${node.property.name}`);
        }
        return;
      case 'ChainExpression':
        expr(node.expression);
        return;
      case 'SequenceExpression':
        node.expressions.forEach(expr);
        return;
      case 'ArrowFunctionExpression':
        arrow(node);
        return;
      default:
        forbid(describe(node.type));
    }
  };

  const arrow = (node: N): void => {
    if (node.async) {
      forbid('async functions');
      return;
    }
    const params = new Set<string>();
    for (const p of node.params) {
      if (p.type === 'Identifier') params.add(p.name);
      else if (p.type === 'AssignmentPattern' && p.left.type === 'Identifier') {
        expr(p.right);
        params.add(p.left.name);
      } else if (p.type === 'RestElement' && p.argument.type === 'Identifier') params.add(p.argument.name);
      else forbid('Destructuring parameters');
    }
    scopes.push(params);
    if (node.body.type === 'BlockStatement') block(node.body);
    else expr(node.body);
    scopes.pop();
  };

  const block = (node: N): void => {
    scopes.push(new Set());
    node.body.forEach(statement);
    scopes.pop();
  };

  const statement = (node: N): void => {
    switch (node.type) {
      case 'ExpressionStatement':
        expr(node.expression);
        return;
      case 'ReturnStatement':
        expr(node.argument);
        return;
      case 'IfStatement':
        expr(node.test);
        statement(node.consequent);
        if (node.alternate) statement(node.alternate);
        return;
      case 'BlockStatement':
        block(node);
        return;
      case 'EmptyStatement':
        return;
      case 'VariableDeclaration':
        if (node.kind === 'var') {
          forbid('var');
          return;
        }
        for (const d of node.declarations) {
          if (d.id.type !== 'Identifier') {
            forbid('Destructuring declarations');
            continue;
          }
          expr(d.init);
          scopes[scopes.length - 1]!.add(d.id.name);
        }
        return;
      default:
        forbid(describe(node.type));
    }
  };

  expr(ast);
  return { issues, literal: literalOf(ast) };
}

function literalOf(node: N): { value: unknown } | undefined {
  if (node.type === 'Literal' && !node.regex) return { value: node.value };
  if (node.type === 'UnaryExpression' && node.operator === '-' && node.argument.type === 'Literal' && typeof node.argument.value === 'number') {
    return { value: -node.argument.value };
  }
  return undefined;
}

function describe(type: string): string {
  const names: Record<string, string> = {
    ThisExpression: 'this',
    NewExpression: 'new',
    AssignmentExpression: 'Assignment',
    UpdateExpression: '++ and --',
    FunctionExpression: 'function expressions',
    ClassExpression: 'Classes',
    ImportExpression: 'import()',
    AwaitExpression: 'await',
    YieldExpression: 'yield',
    TaggedTemplateExpression: 'Tagged templates',
    MetaProperty: 'new.target / import.meta',
    ForStatement: 'Loops',
    ForInStatement: 'Loops',
    ForOfStatement: 'Loops',
    WhileStatement: 'Loops',
    DoWhileStatement: 'Loops',
    TryStatement: 'try',
    ThrowStatement: 'throw',
  };
  return names[type] ?? type;
}
