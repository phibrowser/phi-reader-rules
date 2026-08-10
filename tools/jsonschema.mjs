// A validator for the subset of JSON Schema draft-07 that
// schema/rule.schema.json actually uses: type, required, properties,
// additionalProperties, items, minItems, minLength, pattern, enum, and local
// $ref into #/definitions.
//
// Written by hand so the repository has no install step and no dependency
// tree. The schema stays the single source of truth; this only interprets it.
// If the schema ever needs a keyword that is not handled here, add it here
// rather than validating the same field twice in build.mjs.

const KNOWN = new Set([
  "$schema", "$id", "title", "description", "definitions",
  "type", "required", "properties", "additionalProperties",
  "items", "minItems", "minLength", "pattern", "enum", "$ref",
]);

export function validate(value, schema, root = schema, path = "") {
  const errors = [];

  for (const keyword of Object.keys(schema)) {
    if (!KNOWN.has(keyword)) {
      throw new Error(`schema uses unsupported keyword "${keyword}" at ${path || "/"}`);
    }
  }

  if (schema.$ref) {
    const target = resolve(schema.$ref, root);
    return validate(value, target, root, path);
  }

  const at = path || "(root)";

  if (schema.type && !hasType(value, schema.type)) {
    errors.push(`${at}: expected ${schema.type}, got ${describe(value)}`);
    // Every later check assumes the type held.
    return errors;
  }

  if (schema.enum && !schema.enum.includes(value)) {
    errors.push(`${at}: ${JSON.stringify(value)} is not one of ${schema.enum.join(", ")}`);
  }

  if (schema.type === "string") {
    if (schema.minLength !== undefined && value.length < schema.minLength) {
      errors.push(`${at}: must not be empty`);
    }
    if (schema.pattern && !new RegExp(schema.pattern).test(value)) {
      errors.push(`${at}: ${JSON.stringify(value)} does not match ${schema.pattern}`);
    }
  }

  if (schema.type === "array") {
    if (schema.minItems !== undefined && value.length < schema.minItems) {
      errors.push(`${at}: needs at least ${schema.minItems} item(s)`);
    }
    if (schema.items) {
      value.forEach((item, i) => {
        errors.push(...validate(item, schema.items, root, `${path}[${i}]`));
      });
    }
  }

  if (schema.type === "object") {
    for (const key of schema.required ?? []) {
      if (value[key] === undefined) {
        errors.push(`${at}: missing required property "${key}"`);
      }
    }
    const properties = schema.properties ?? {};
    if (schema.additionalProperties === false) {
      for (const key of Object.keys(value)) {
        if (!(key in properties)) {
          errors.push(`${at}: unknown property "${key}"`);
        }
      }
    }
    for (const [key, subschema] of Object.entries(properties)) {
      if (value[key] !== undefined) {
        errors.push(...validate(value[key], subschema, root, `${path}.${key}`));
      }
    }
  }

  return errors;
}

function resolve(ref, root) {
  if (!ref.startsWith("#/")) {
    throw new Error(`only local $ref is supported, got "${ref}"`);
  }
  let node = root;
  for (const segment of ref.slice(2).split("/")) {
    node = node?.[segment];
    if (node === undefined) {
      throw new Error(`$ref "${ref}" does not resolve`);
    }
  }
  return node;
}

function hasType(value, type) {
  switch (type) {
    case "object":
      return typeof value === "object" && value !== null && !Array.isArray(value);
    case "array":
      return Array.isArray(value);
    case "string":
      return typeof value === "string";
    default:
      throw new Error(`schema uses unsupported type "${type}"`);
  }
}

function describe(value) {
  if (value === null) return "null";
  if (Array.isArray(value)) return "array";
  return typeof value;
}
