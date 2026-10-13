import { execFileSync } from "node:child_process";
import { writeFileSync } from "node:fs";
import { resolve } from "node:path";

const apiId = process.env.API_ID;
const region = process.env.AWS_REGION ?? "us-east-1";
const prefix = process.env.STACK_PREFIX ?? "super-transcriber-api-dev";
if (!apiId || !/^super-transcriber-api-[a-z0-9-]+$/.test(prefix)) throw new Error("Set API_ID and a Super Transcriber API STACK_PREFIX");
const aws = (...args) => JSON.parse(execFileSync("aws", [...args, "--region", region, "--output", "json"], { encoding: "utf8", maxBuffer: 16 * 1024 * 1024 }));
const api = aws("apigatewayv2", "get-api", "--api-id", apiId);
if (api.Name !== prefix) throw new Error("API name does not match the selected stack");
const imports = [];
const add = (to, id) => imports.push(`import {\n  to = ${to}\n  id = ${JSON.stringify(id)}\n}`);
add("aws_apigatewayv2_api.http", apiId);
add("aws_apigatewayv2_stage.default", `${apiId}/$default`);
for (const route of aws("apigatewayv2", "get-routes", "--api-id", apiId).Items) {
  add(`aws_apigatewayv2_route.lambda[${JSON.stringify(route.RouteKey)}]`, `${apiId}/${route.RouteId}`);
  add(`aws_apigatewayv2_integration.lambda[${JSON.stringify(route.RouteKey)}]`, `${apiId}/${route.Target.split("/")[1]}`);
}
const functions = aws("lambda", "list-functions").Functions.filter(fn => fn.FunctionName.startsWith(prefix + "-"));
const logs = new Set(aws("logs", "describe-log-groups", "--log-group-name-prefix", `/aws/lambda/${prefix}-`).logGroups.map(group => group.logGroupName));
for (const fn of functions) {
  const key = JSON.stringify(fn.FunctionName.slice(prefix.length + 1));
  add(`aws_lambda_function.handlers[${key}]`, fn.FunctionName);
  add(`aws_iam_role.lambda[${key}]`, fn.Role.split("/").at(-1));
  const policies = aws("iam", "list-role-policies", "--role-name", fn.Role.split("/").at(-1)).PolicyNames;
  if (policies.includes(fn.FunctionName)) add(`aws_iam_role_policy.lambda[${key}]`, `${fn.Role.split("/").at(-1)}:${fn.FunctionName}`);
  if (logs.has(`/aws/lambda/${fn.FunctionName}`)) add(`aws_cloudwatch_log_group.lambda[${key}]`, `/aws/lambda/${fn.FunctionName}`);
  let policy = { Statement: [] };
  try { policy = JSON.parse(aws("lambda", "get-policy", "--function-name", fn.FunctionName).Policy); }
  catch (error) { if (!String(error.stderr).includes("ResourceNotFoundException")) throw error; }
  if (policy.Statement.some(statement => statement.Sid === "AllowHttpApiInvoke")) add(`aws_lambda_permission.api_gateway[${key}]`, `${fn.FunctionName}/AllowHttpApiInvoke`);
  if (policy.Statement.some(statement => statement.Sid === "AllowEventBridgeCompletionInvoke")) add("aws_lambda_permission.eventbridge_completion", `${fn.FunctionName}/AllowEventBridgeCompletionInvoke`);
}
const config = aws("lambda", "get-function-configuration", "--function-name", `${prefix}-health`).Environment.Variables;
add("aws_dynamodb_table.main", config.TABLE_NAME);
for (const [name, bucket] of [["uploads", config.UPLOAD_BUCKET], ["transcripts", config.TRANSCRIPT_BUCKET]]) {
  if (!bucket.startsWith("super-transcriber-api-")) throw new Error("Bucket does not belong to this API");
  add(`aws_s3_bucket.${name}`, bucket);
  for (const resource of ["server_side_encryption_configuration", "lifecycle_configuration", "policy"]) add(`aws_s3_bucket_${resource}.${name}`, bucket);
  add(`aws_s3_bucket_public_access_block.private[${JSON.stringify(name)}]`, bucket);
  add(`aws_s3_bucket_ownership_controls.private[${JSON.stringify(name)}]`, bucket);
}
const queueNames = { transcription_start: "transcription-start", transcription_start_dlq: "transcription-start-dlq", webhook_delivery: "webhook-delivery", webhook_delivery_dlq: "webhook-delivery-dlq", enrichment: "enrichment", enrichment_dlq: "enrichment-dlq", transcribe_completion_dlq: "transcribe-completion-dlq" };
for (const [name, suffix] of Object.entries(queueNames)) {
  const url = aws("sqs", "get-queue-url", "--queue-name", `${prefix}-${suffix}`).QueueUrl;
  add(`aws_sqs_queue.${name}`, url);
  if (name === "transcribe_completion_dlq") add("aws_sqs_queue_policy.transcribe_completion_dlq", url);
}
for (const mapping of aws("lambda", "list-event-source-mappings").EventSourceMappings) {
  const name = { "start-transcription": "transcription_start", "deliver-webhook": "webhook_delivery", "enrich-transcript": "enrichment" }[mapping.FunctionArn.split(":").at(-1)?.slice(prefix.length + 1)];
  if (mapping.FunctionArn.split(":").at(-1)?.startsWith(prefix + "-") && name) add(`aws_lambda_event_source_mapping.${name}`, mapping.UUID);
}
const rule = `${prefix}-transcribe-completion`;
add("aws_cloudwatch_event_rule.transcribe_completion", rule);
const target = aws("events", "list-targets-by-rule", "--rule", rule).Targets.find(target => target.Arn.endsWith(`${prefix}-completion`));
if (!target) throw new Error("Completion target not found");
add("aws_cloudwatch_event_target.transcribe_completion", `${rule}/${target.Id}`);
writeFileSync(resolve("terraform/adoption.auto.tf"), imports.join("\n\n") + "\n");
writeFileSync(resolve("terraform/terraform.tfvars"), [
  `admin_token_secret_arn = ${JSON.stringify(config.ADMIN_TOKEN_SECRET_ARN)}`,
  "enable_sqs_workers = true", "enable_cloudwatch_alarms = false", "enable_point_in_time_recovery = false",
  `stripe_secret_arn = ${JSON.stringify(config.STRIPE_SECRET_ARN ?? "")}`,
  `stripe_webhook_secret_arn = ${JSON.stringify(config.STRIPE_WEBHOOK_SECRET_ARN ?? "")}`,
  `stripe_price_ids = ${config.STRIPE_PRICE_IDS_JSON ?? "{}"}`
].join("\n") + "\n");
console.log(`Prepared ${imports.length} import blocks for ${prefix}. Review terraform plan before applying; secret values were not read.`);
