// JSON data files are large; type them at the import site instead of letting TS infer them.
declare module '*.json' {
  const value: unknown;
  export default value;
}
