
declare module "*?url" {
  const src: string;
  export default src;
}

declare module "*?worker&inline" {
  const workerConstructor: {
    new (options?: { name?: string }): Worker;
  };
  export default workerConstructor;
}
