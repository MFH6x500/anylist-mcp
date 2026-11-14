// The pinned AnyList fork only calls require('uuid/v4')() without arguments.
// Use the maintained Node runtime, rather than retaining uuid 3 for that call.
module.exports = function v4(...args) {
  if (args.length) throw new TypeError('AnyList UUID adapter accepts no arguments');
  return require('node:crypto').randomUUID();
};
