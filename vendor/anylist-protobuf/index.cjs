'use strict';
// Narrow compatibility for AnyList's bundled v5 schema and message API.
// Wire encoding/decoding belongs entirely to the maintained protobuf runtime.
const pb = require('protobufjs-modern');
const MAX_PROTOBUF_BYTES = 16 * 1024 * 1024;

function schema(nodes) {
  const nested = Object.create(null);
  for (const node of nodes.messages || []) {
    const fields = Object.create(null);
    for (const field of node.fields || []) {
      fields[field.name] = {
        type: field.type, id: field.id,
        ...(field.rule === 'map' ? { keyType: field.keytype } : { rule: field.rule }),
        ...(field.options ? { options: field.options } : {}),
      };
    }
    nested[node.name] = { edition: 'proto2', fields, nested: schema(node), ...(node.options ? { options: node.options } : {}) };
  }
  for (const node of nodes.enums || []) {
    nested[node.name] = { edition: 'proto2', values: Object.fromEntries(node.values.map(value => [value.name, value.id])) };
  }
  return nested;
}

function build(definition, namespace) {
  if (definition.package !== 'pcov.proto' || namespace !== definition.package) {
    throw new Error('Only the bundled AnyList pcov.proto schema is supported');
  }
  const root = new pb.Root();
  root.define(namespace).addJSON(schema(definition));
  root.resolveAll();
  const constructors = new Map();

  function messageClass(type) {
    if (constructors.has(type)) return constructors.get(type);
    class Message {
      constructor(values = {}) {
        for (const field of type.fieldsArray) {
          const value = values[field.name];
          const convert = entry => field.resolvedType instanceof pb.Type
            ? new (messageClass(field.resolvedType))(entry) : entry;
          if (field.map) {
            this[field.name] = Object.fromEntries(Object.entries(value || {}).map(([key, entry]) => [key, convert(entry)]));
          } else if (field.repeated) {
            this[field.name] = (value == null ? [] : Array.isArray(value) ? value : [value]).map(convert);
          } else {
            this[field.name] = value == null ? null : convert(value);
          }
        }
        for (const key of Object.keys(values)) {
          if (!type.fields[key] && values[key] != null) throw new Error(`${type.name}.${key} is not a field`);
        }
      }
      toBuffer() {
        // fromObject normalises enum names and 64-bit values before verification.
        const converted = type.fromObject(this);
        const error = type.verify(converted);
        if (error) throw new Error(`${type.name}: ${error}`);
        const bytes = type.encode(converted).finish();
        if (bytes.length > MAX_PROTOBUF_BYTES) throw new Error('AnyList protobuf message exceeds 16 MiB');
        return Buffer.from(bytes);
      }
      static decode(bytes) {
        if (bytes.length > MAX_PROTOBUF_BYTES) throw new Error('AnyList protobuf message exceeds 16 MiB');
        const decoded = type.decode(bytes);
        // Do not populate absent scalar defaults: the v5 consumer expects null.
        return new Message(type.toObject(decoded, { longs: String, defaults: false }));
      }
    }
    constructors.set(type, Message);
    for (const field of type.fieldsArray) {
      const suffix = field.name[0].toUpperCase() + field.name.slice(1);
      Message.prototype[`set${suffix}`] = function(value) {
        this[field.name] = new Message({ [field.name]: value })[field.name];
        return this;
      };
      Message.prototype[`get${suffix}`] = function() { return this[field.name]; };
    }
    for (const child of type.nestedArray) {
      if (child instanceof pb.Enum) Message[child.name] = child.values;
      else if (child instanceof pb.Type) Message[child.name] = messageClass(child);
    }
    return Message;
  }
  return Object.fromEntries(root.lookup(namespace).nestedArray.map(type => [type.name,
    type instanceof pb.Type ? messageClass(type) : type.values]));
}

module.exports = {
  MAX_PROTOBUF_BYTES,
  newBuilder() {
    let definition;
    return {
      import(value) { definition = value; return this; },
      build(namespace) { return build(definition, namespace); },
    };
  },
};
