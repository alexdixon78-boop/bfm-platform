# ECS + S3 Deployment Guide

This guide describes the AWS ECS/Fargate deployment shape for the Brighter Future Mediation CRM.

## Docker Build

Build locally:

```bash
docker build -t bfm-crm:dev .
```

Local smoke test with local uploads:

```bash
docker run --rm -p 5000:5000 \
  --env-file .env \
  -e CONFIG_SOURCE=local \
  -e SESSION_COOKIE_SECURE=false \
  -e STORAGE_DRIVER=local \
  bfm-crm:dev
```

```bash
docker run --rm -p 5000:5000 \
  --env-file .env \
  -e CONFIG_SOURCE=aws \
  bfm-crm:dev
```

The container listens on `0.0.0.0:5000` and exposes `5000`. Local HTTP smoke tests must use non-secure cookies; ECS behind an HTTPS ALB should omit `SESSION_COOKIE_SECURE` or set it to `true`.

## ECS Task Expectations

- Use the built image from ECR.
- Run one task initially because background jobs are in-process.
- Give the task a task role with Secrets Manager, Parameter Store, and S3 permissions.
- Set the ALB target group health check path to `/healthz`.
- Do not bake `.env`, uploads, or AWS access keys into the image.

## Runtime Environment

Set only bootstrap values directly on the task:

```text
CONFIG_SOURCE=aws
AWS_REGION=us-east-1
SECRETMANGER_NAME=dev-secret
AWS_PARAMETER_STORE_PATH=/bfm/dev/app/config/  # optional
PORT=5000
```

`AWS_SECRETS_MANAGER_SECRET_ID` remains supported as a backward-compatible
fallback when `SECRETMANGER_NAME` is not set. Deployed AWS environments should
use the ECS/EC2 IAM role credential chain. For local development only, the app
can use `ACCESS_KEY` and `SECRET_KEY` when both are set.

Use Parameter Store for safe config when `AWS_PARAMETER_STORE_PATH` is set:

```text
NODE_ENV=production
APP_URL=https://crm-dev.example.com
BASE_URL=https://crm-dev.example.com
GOOGLE_CLIENT_ID=...
GOOGLE_REDIRECT_URI=https://crm-dev.example.com/api/auth/callback/google
SENDGRID_FROM_EMAIL=...
ADMIN_NOTIFICATION_EMAIL=...
CALENDLY_ORGANIZATION_URI=...
META_WHATSAPP_PHONE_NUMBER_ID=...
META_WHATSAPP_BUSINESS_ACCOUNT_ID=...
META_WHATSAPP_DEFAULT_TEMPLATE=bfm_case_update
META_WHATSAPP_ENQUIRY_FLOW_ID=...
META_WHATSAPP_ENQUIRY_FLOW_SCREEN=ENQUIRY_FORM
BFM_CALENDAR_EMAIL=info@brighterfuturemediation.co.uk
LOG_LEVEL=info
STORAGE_DRIVER=s3
S3_UPLOAD_BUCKET=bfm-dev-uploads
S3_UPLOAD_REGION=eu-west-2
S3_UPLOAD_PREFIX=mediator-service-approvals
```

Use Secrets Manager JSON for sensitive values. If you are not using Parameter Store,
put all required runtime values in this JSON instead:

```json
{
  "DATABASE_URL": "postgresql://...",
  "SESSION_SECRET": "...",
  "NODE_ENV": "production",
  "APP_URL": "https://crm-dev.example.com",
  "BASE_URL": "https://crm-dev.example.com",
  "GOOGLE_CLIENT_ID": "...",
  "GOOGLE_CLIENT_SECRET": "...",
  "GOOGLE_REDIRECT_URI": "https://crm-dev.example.com/api/auth/callback/google",
  "SENDGRID_API_KEY": "...",
  "SENDGRID_FROM_EMAIL": "...",
  "ADMIN_NOTIFICATION_EMAIL": "...",
  "CALENDLY_PAT": "...",
  "CALENDLY_WEBHOOK_SIGNING_KEY": "...",
  "STRIPE_SECRET_KEY": "...",
  "STRIPE_WEBHOOK_SECRET": "...",
  "META_WHATSAPP_VERIFY_TOKEN": "...",
  "META_WHATSAPP_APP_SECRET": "...",
  "META_WHATSAPP_ACCESS_TOKEN": "..."
}
```

## IAM Permissions

Task role minimum:

```json
{
  "Version": "2012-10-17",
  "Statement": [
    {
      "Effect": "Allow",
      "Action": ["secretsmanager:GetSecretValue"],
      "Resource": "arn:aws:secretsmanager:REGION:ACCOUNT_ID:secret:/bfm/dev/app/secrets*"
    },
    {
      "Effect": "Allow",
      "Action": ["ssm:GetParametersByPath"],
      "Resource": "arn:aws:ssm:REGION:ACCOUNT_ID:parameter/bfm/dev/app/config/*"
    },
    {
      "Effect": "Allow",
      "Action": ["s3:PutObject", "s3:GetObject", "s3:DeleteObject"],
      "Resource": "arn:aws:s3:::bfm-dev-uploads/mediator-service-approvals/*"
    }
  ]
}
```

Add `kms:Decrypt` if Secrets Manager, Parameter Store, or S3 objects use a customer-managed KMS key.

## S3 Layout

- Bucket: private.
- Prefix: `mediator-service-approvals/`.
- Objects are written by the app using ECS task-role credentials.
- Proof links keep the existing `/uploads/mediator-service-approvals/:fileName` shape; in S3 mode the backend proxies those requests from S3.
- Private WhatsApp note attachments and communication-only outbound media use separate private prefixes. They are limited to 10 MB, validated by their actual file signature/type, and are never exposed through public S3 URLs.
- WhatsApp attachments are not malware-scanned. Downloads remain available only through authenticated application endpoints with `Cache-Control: no-store` and `X-Content-Type-Options: nosniff`.

## Database Connectivity

- `DATABASE_URL` must point to the AWS development PostgreSQL instance.
- ECS security group must be allowed to reach the DB security group.
- Subnets and route tables must permit DB connectivity.
- Run `npm run db:push` against the AWS dev DB, or rely only on the existing startup bootstrap where appropriate.

## Deploy Order

1. Create/update S3 bucket and prefix policy.
2. Create/update Secrets Manager JSON secret.
3. Create/update Parameter Store config path.
4. Create/update ECS task role permissions.
5. Build image and push to ECR.
6. Update ECS task definition with image and bootstrap env.
7. Deploy ECS service behind ALB.
8. Confirm `/healthz`, login, DB access, and S3 proof upload/download.

## Rollback

- Keep the previous ECS task definition revision.
- Roll back the ECS service to the previous task definition if health checks or smoke tests fail.
- Do not delete or overwrite S3 objects during rollback.
- Preserve old Secrets Manager versions until the new deployment is stable.

## Local Upload Migration

Existing files under local `uploads/mediator-service-approvals` must be copied to S3 before ECS becomes the source of truth. Preserve the file names so existing `/uploads/mediator-service-approvals/:fileName` database links continue to resolve.
