import { readFileSync } from "node:fs";
const plan = JSON.parse(readFileSync(0, "utf8"));
const destructive = (plan.resource_changes ?? []).filter(resource => resource.change.actions.includes("delete"));
if (destructive.length) throw new Error(`Destructive plan requires separate review: ${destructive.map(resource => resource.address).join(", ")}`);
console.log(`Plan contains no resource deletions or replacements (${plan.resource_changes?.length ?? 0} resources checked).`);
