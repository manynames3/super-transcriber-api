# Validation Evidence

This file records validation commands for the initial repository baseline.

| Command | Result |
| --- | --- |
| `npm install` in `lambda/` | Passed. Created `package-lock.json`. Full `npm audit` reports 0 vulnerabilities after dev toolchain updates. |
| `npm run build` in `lambda/` | Passed. TypeScript completed with `tsc --noEmit`. |
| `npm test` in `lambda/` | Passed. 4 test files and 12 tests passed. |
| `npm run bundle` in `lambda/` | Passed. Built zip artifacts for 8 Lambda handlers. |
| `terraform fmt -recursive` | Passed. Reformatted `terraform/main.tf`. |
| `terraform init -backend=false` in `terraform/` | Passed. Installed `hashicorp/aws` provider v5.100.0 and wrote `.terraform.lock.hcl`. |
| `terraform validate` in `terraform/` | Passed. Terraform reported the configuration is valid. |
| `git diff --check` | Passed after initializing the local repository and adding files as intent-to-add. |
