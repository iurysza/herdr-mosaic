import { defineRule } from "@oxlint/plugins";

import { resolveVariable } from "../shared/scope.ts";

import type { ESTree, SourceCode } from "@oxlint/plugins";

const moduleMockMethods = new Set(["doMock", "mock", "unstable_mockModule"]);

function importedName(node: ESTree.Node): string | null {
  if (node.type !== "ImportSpecifier") return null;
  return node.imported.type === "Identifier" ? node.imported.name : node.imported.value;
}

function importBinding(
  sourceCode: SourceCode,
  expression: ESTree.Expression,
): { source: string; name: string | null } | null {
  if (expression.type !== "Identifier") return null;
  const variable = resolveVariable(sourceCode, expression);
  if (variable === null || variable.defs.length === 0) return null;
  for (const definition of variable.defs) {
    if (definition.type !== "ImportBinding" || definition.parent?.type !== "ImportDeclaration") {
      continue;
    }
    return {
      source: definition.parent.source.value,
      name: importedName(definition.node),
    };
  }
  return null;
}

function isTestFrameworkObject(
  sourceCode: SourceCode,
  expression: ESTree.Expression,
): expression is ESTree.IdentifierReference {
  if (expression.type !== "Identifier") return false;
  if (
    (expression.name === "vi" || expression.name === "jest") &&
    sourceCode.isGlobalReference(expression)
  ) {
    return true;
  }

  const binding = importBinding(sourceCode, expression);
  if (binding === null) {
    return expression.name === "vi" || expression.name === "jest";
  }
  return (
    (binding.source === "vitest" && binding.name === "vi") ||
    (binding.source === "@jest/globals" && binding.name === "jest")
  );
}

function isBunMockObject(sourceCode: SourceCode, expression: ESTree.Expression): boolean {
  if (expression.type !== "Identifier") return false;
  const binding = importBinding(sourceCode, expression);
  if (binding !== null) {
    return binding.source === "bun:test" && binding.name === "mock";
  }
  return expression.name === "mock" && sourceCode.isGlobalReference(expression);
}

function memberMethod(callee: ESTree.Expression): string | null {
  if (!("property" in callee) || !("object" in callee) || !("computed" in callee)) return null;
  const property = callee.property;
  if (callee.computed) {
    return property.type === "Literal" && typeof property.value === "string" ? property.value : null;
  }
  return property.type === "Identifier" ? property.name : null;
}

function moduleMockCall(sourceCode: SourceCode, callee: ESTree.Expression): boolean {
  if (!("property" in callee) || !("object" in callee) || !("computed" in callee)) return false;
  const method = memberMethod(callee);
  if (method === null) return false;
  if (isBunMockObject(sourceCode, callee.object) && method === "module") return true;
  if (!isTestFrameworkObject(sourceCode, callee.object)) return false;
  return moduleMockMethods.has(method);
}

/** Ban test framework module mocking in favor of real dependency seams. */
export const noModuleMockingRule = defineRule({
  meta: {
    type: "problem",
    docs: {
      description:
        "Disallow Vitest, Jest, and Bun module mocking; tests must replace dependencies through real interfaces.",
    },
    messages: {
      moduleMock:
        "Replace module mocking with dependency injection through a real interface, service layer, or faithful test implementation.",
    },
  },
  createOnce(context) {
    return {
      CallExpression(node) {
        if (node.callee.type === "Super" || node.callee.type === "V8IntrinsicExpression") return;
        if (moduleMockCall(context.sourceCode, node.callee)) {
          context.report({ node, messageId: "moduleMock" });
        }
      },
    };
  },
});
