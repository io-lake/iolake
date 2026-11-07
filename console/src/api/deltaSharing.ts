export interface RecipientProfile {
  shareCredentialsVersion: number;
  endpoint: string;
  bearerToken: string;
}

// Endpoint needs /v1: the gateway serves Delta Sharing at /delta-sharing/v1 (#67).
export function recipientProfile(
  origin: string,
  bearerToken: string,
): RecipientProfile {
  return {
    shareCredentialsVersion: 1,
    endpoint: `${origin}/delta-sharing/v1`,
    bearerToken,
  };
}
