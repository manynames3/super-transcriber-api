import { lookup } from "node:dns";
import { request } from "node:https";
import { isPublicAddress, parseWebhookUrl } from "./validation.js";

export async function postWebhook(
  url: string,
  body: string,
  headers: Record<string, string>,
): Promise<number> {
  const target = parseWebhookUrl(url);
  return new Promise((resolve, reject) => {
    const req = request(
      target,
      {
        method: "POST",
        headers: { ...headers, "content-length": Buffer.byteLength(body) },
        signal: AbortSignal.timeout(
          Number(process.env.WEBHOOK_TIMEOUT_MS ?? "10000"),
        ),
        lookup(hostname, options, callback) {
          lookup(hostname, { all: true }, (error, addresses) => {
            if (error) {
              callback(error, "", 4);
              return;
            }
            if (
              !addresses.length ||
              addresses.some((entry) => !isPublicAddress(entry.address))
            ) {
              callback(
                new Error(
                  "Webhook destination resolves to a non-public address",
                ),
                "",
                4,
              );
              return;
            }
            if (typeof options === "object" && options.all)
              callback(null, addresses);
            else callback(null, addresses[0].address, addresses[0].family);
          });
        },
      },
      (response) => {
        response.resume();
        resolve(response.statusCode ?? 0);
      },
    );
    req.on("error", reject);
    req.end(body);
  });
}
