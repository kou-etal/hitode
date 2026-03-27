import { fromSSO } from "@aws-sdk/credential-provider-sso";

const profile = process.env.AWS_PROFILE;

export const awsCredentials = profile ? { credentials: fromSSO({ profile }) } : {};
export const awsRegion = process.env.AWS_REGION ?? "us-east-1";
