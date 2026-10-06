/**
 * Helpers for turning the various ways IIIF describes annotations into the
 * Presentation API v3 shape the viewer works with.
 *
 * Everything here is a pure function of raw JSON, so it can be tested without a browser.
 */

export type RawAnnotationBody = {
  id?: string;
  type: string;
  value?: string;
  language?: string;
  format?: string;
};

export type RawAnnotation = {
  id: string;
  type: string;
  motivation: string;
  body: RawAnnotationBody | RawAnnotationBody[];
  target: string | Record<string, unknown> | null;
};

export type RawAnnotationPage = {
  id: string;
  type: string;
  items: Array<RawAnnotation>;
};

type JSONObject = Record<string, unknown>;

function isObject(value: unknown): value is JSONObject {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function asArray(value: unknown): unknown[] {
  if (value === undefined || value === null) return [];
  return Array.isArray(value) ? value : [value];
}

function asString(value: unknown): string | undefined {
  return typeof value === "string" && value !== "" ? value : undefined;
}

/**
 * Presentation v2 describes text as a plain string, a `{ "@value", "@language" }` object,
 * or an array of either. Returns the first value found, or an empty string
 */
export function iiifValueToString(value: unknown): string {
  for (const item of asArray(value)) {
    if (typeof item === "string") return item;
    if (isObject(item) && typeof item["@value"] === "string") {
      return item["@value"];
    }
  }
  return "";
}

/**
 * Whether a value is a single v2 style `{ "@value" }` object\
 * (A shape some language map parsers don't cope with)
 */
export function isSingleV2Value(value: unknown): boolean {
  return isObject(value) && "@value" in value;
}

/**
 * Get the id of the first image service on a v2 canvas\
 * `canvas.images[0].resource.service`
 */
export function getV2ImageServiceId(canvas: unknown): string | undefined {
  if (!isObject(canvas)) return undefined;

  for (const image of asArray(canvas.images)) {
    if (!isObject(image) || !isObject(image.resource)) continue;

    for (const service of asArray(image.resource.service)) {
      if (!isObject(service)) continue;
      const id = asString(service["@id"]) ?? asString(service.id);
      if (id) return id;
    }
  }
  return undefined;
}

/**
 * Convert the target of a v2 annotation (`on`) to a v3 style target string\
 * Handles a plain canvas URI (with or without a `#xywh=` fragment), and the
 * `oa:SpecificResource` form with a fragment selector
 */
export function getV2Target(on: unknown): string | null {
  if (typeof on === "string") return on;

  // Multiple targets aren't something the viewer can use. Take the first
  if (Array.isArray(on)) return getV2Target(on[0]);

  if (isObject(on)) {
    const full =
      asString(on.full) ?? asString(on.source) ?? asString(on["@id"]);
    const selector = on.selector;

    if (full && isObject(selector)) {
      const value = asString(selector.value);
      const type = asString(selector["@type"]) ?? asString(selector.type);
      // Only fragment selectors with a region can be expressed as a URL fragment
      if (
        value &&
        (type?.endsWith("FragmentSelector") || /^xywh=/.test(value))
      ) {
        return `${full}#${value}`;
      }
    }
    return full ?? null;
  }

  return null;
}

/**
 * Convert one v2 annotation body (`resource`) to a v3 style body
 * Returns null for anything the viewer can't display
 */
export function normaliseV2Body(resource: unknown): RawAnnotationBody | null {
  if (!isObject(resource)) return null;

  const type = asString(resource["@type"]) ?? asString(resource.type) ?? "";
  const format = asString(resource.format);
  const id = asString(resource["@id"]) ?? asString(resource.id);

  if (typeof resource.chars === "string") {
    return {
      type: "TextualBody",
      value: resource.chars,
      format: format ?? "text/plain",
      ...(asString(resource.language) && {
        language: asString(resource.language),
      }),
    };
  }

  if (/sound/i.test(type) || format?.startsWith("audio/")) {
    return id ? { id, type: "Sound", ...(format && { format }) } : null;
  }

  return null;
}

/**
 * Convert a v2 annotation to the v3 shape
 */
export function normaliseV2Annotation(raw: unknown): RawAnnotation | null {
  if (!isObject(raw)) return null;

  const bodies = asArray(raw.resource)
    .map(normaliseV2Body)
    .filter((body): body is RawAnnotationBody => body !== null);

  const motivation = asString(raw.motivation) ?? "commenting";

  return {
    id: asString(raw["@id"]) ?? asString(raw.id) ?? "",
    type: "Annotation",
    // "sc:painting" -> "painting"
    motivation: motivation.replace(/^[a-z]+:/i, ""),
    body: bodies.length === 1 ? bodies[0] : bodies,
    target: getV2Target(raw.on),
  };
}

/**
 * Get the annotations from a raw annotation page (v3) or annotation list (v2), as v3 annotations\
 * Returns null if neither list of annotations is present, which means the page is only a reference
 * that needs fetching
 */
export function getAnnotationsFromPage(page: unknown): RawAnnotation[] | null {
  if (!isObject(page)) return null;

  if (Array.isArray(page.items)) {
    return page.items as RawAnnotation[];
  }

  if (Array.isArray(page.resources)) {
    return page.resources
      .map(normaliseV2Annotation)
      .filter((annotation): annotation is RawAnnotation => annotation !== null);
  }

  return null;
}

/**
 * Get every annotation page (v3: `annotations`) and annotation list (v2: `otherContent`)
 * referenced by a raw canvas, in order
 */
export function getCanvasAnnotationPages(canvas: unknown): unknown[] {
  if (!isObject(canvas)) return [];
  return [...asArray(canvas.annotations), ...asArray(canvas.otherContent)];
}

/**
 * Get the URL an annotation page or list can be fetched from
 */
export function getPageUrl(page: unknown): string | undefined {
  if (!isObject(page)) return undefined;
  return asString(page.id) ?? asString(page["@id"]);
}

/**
 * Get the URL of the thumbnail a canvas provides for itself, if any\
 * v3: `thumbnail: [{ id }]`, v2: `thumbnail: "url"` or `{ "@id" }`
 */
export function getCanvasThumbnailUrl(canvas: unknown): string | undefined {
  if (!isObject(canvas)) return undefined;

  for (const thumbnail of asArray(canvas.thumbnail)) {
    if (typeof thumbnail === "string" && thumbnail !== "") return thumbnail;
    if (isObject(thumbnail)) {
      const id = asString(thumbnail.id) ?? asString(thumbnail["@id"]);
      if (id) return id;
    }
  }
  return undefined;
}

/**
 * Pick which of an image service's `sizes` to use for something about `target` pixels wide\
 * The smallest size that's at least the target, otherwise the largest available.\
 * This matters because level 0 image services only deliver the sizes they list.\
 * Returns undefined if there are no usable sizes
 */
export function chooseImageSize(
  sizes: unknown,
  target: number,
): number | undefined {
  const widths = asArray(sizes)
    .map((size) => (isObject(size) ? size.width : undefined))
    .filter(
      (width): width is number =>
        typeof width === "number" && Number.isFinite(width) && width > 0,
    )
    .sort((a, b) => a - b);

  if (!widths.length) return undefined;
  return widths.find((width) => width >= target) ?? widths[widths.length - 1];
}

/**
 * Build an IIIF Image API URL for the whole image at a given width\
 * `{service}/full/{width},/0/default.jpg` is valid in both versions 2 and 3 of the Image API
 */
export function buildImageUrl(serviceId: string, width: number): string {
  const base = serviceId.replace(/\/?(?:info\.json)?$/, "");
  return `${base}/full/${width},/0/default.jpg`;
}
