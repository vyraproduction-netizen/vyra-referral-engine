export type SingleRowRpc<T> = {
  single: () => PromiseLike<T>;
};

export function singleRpcRow<T>(request: SingleRowRpc<T>): PromiseLike<T> {
  return request.single();
}