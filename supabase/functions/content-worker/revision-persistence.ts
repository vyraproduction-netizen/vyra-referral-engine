import type {
  ContentRevisionDraft,
  ContentRevisionJob,
} from "./revision.ts";
import {
  buildCreateContentRevisionArgs,
  parseContentRevisionResult,
} from "./revision-rpc.ts";
import type {
  CreateContentRevisionArgs,
  SavedContentRevision,
} from "./revision-rpc.ts";

export type ContentRevisionRpcResponse = {
  data: unknown;
  error: {
    message: string;
  } | null;
};

export type ContentRevisionRpc = (
  args: CreateContentRevisionArgs,
) => PromiseLike<ContentRevisionRpcResponse>;

export async function persistContentRevision(
  callRpc: ContentRevisionRpc,
  job: ContentRevisionJob,
  draft: ContentRevisionDraft,
): Promise<SavedContentRevision> {
  const args = buildCreateContentRevisionArgs(
    job,
    draft,
  );
  const { data, error } = await callRpc(args);

  if (error) {
    throw new Error(
      `Content revision persistence failed: ${error.message}`,
    );
  }

  return parseContentRevisionResult(
    data,
    job,
    draft,
  );
}
