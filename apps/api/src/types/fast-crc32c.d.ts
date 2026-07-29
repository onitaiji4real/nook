declare module 'fast-crc32c' {
  const crc32c: {
    calculate(input: string | Uint8Array, initial?: number): number;
  };

  export default crc32c;
}
