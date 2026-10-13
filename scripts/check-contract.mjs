import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
const require = createRequire(new URL("../lambda/package.json", import.meta.url));
const { parse } = require("yaml");
const contract = parse(readFileSync(new URL("../openapi/openapi.yaml", import.meta.url), "utf8"));
const terraform = readFileSync(new URL("../terraform/api-gateway.tf", import.meta.url), "utf8");
const routes = new Set([...terraform.matchAll(/"((?:GET|POST|DELETE) \/[^"]*)"\s*=\s*\{/g)].map(match => match[1]));
const declared = new Set();
const ids = new Set();
for (const [path, item] of Object.entries(contract.paths)) {
  for (const [method, operation] of Object.entries(item)) {
    if (!["get", "post", "delete"].includes(method)) continue;
    const route = `${method.toUpperCase()} ${path}`;
    declared.add(route);
    if (!routes.has(route)) throw new Error(`OpenAPI route is not deployed: ${route}`);
    if (!operation.operationId || ids.has(operation.operationId)) throw new Error(`Missing/duplicate operationId: ${route}`);
    ids.add(operation.operationId);
    for (const name of [...path.matchAll(/\{([^}]+)\}/g)].map(match => match[1])) {
      const parameters = [...(item.parameters ?? []), ...(operation.parameters ?? [])].map(parameter => parameter.$ref
        ? contract.components.parameters[parameter.$ref.split("/").at(-1)] : parameter);
      if (!parameters.some(parameter => parameter.name === name && parameter.in === "path" && parameter.required)) throw new Error(`Missing path parameter ${name}: ${route}`);
    }
  }
}
for (const route of routes) if (!declared.has(route)) throw new Error(`Deployed route missing from OpenAPI: ${route}`);
function checkRefs(value) {
  if (!value || typeof value !== "object") return;
  if (value.$ref) {
    if (!value.$ref.startsWith("#/")) throw new Error("Only local OpenAPI refs are supported");
    const target = value.$ref.slice(2).split("/").reduce((node, key) => node?.[key], contract);
    if (!target) throw new Error(`Broken OpenAPI ref: ${value.$ref}`);
  }
  Object.values(value).forEach(checkRefs);
}
checkRefs(contract);
console.log(`OpenAPI matches ${routes.size} Terraform routes; references, operation IDs, and path parameters are valid.`);
