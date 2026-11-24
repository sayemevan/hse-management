/**
 * The authenticated caller, established by the `authenticate` middleware.
 *
 * It carries identity only. Roles and permissions are never read from the token:
 * they are resolved on the server for each request (Doc 07 §18: "Never trust
 * client-side role information").
 */
export interface Principal {
  readonly userId: string;
  readonly sessionId: string;
}
