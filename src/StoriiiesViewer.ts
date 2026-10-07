import "./css/styles.css";
import type { Config } from "dompurify";
import DOMPurify from "dompurify";
import {
  Annotation,
  AnnotationPage,
  Canvas,
  loadManifest,
  Manifest,
} from "manifesto.js";
import OpenSeadragon from "openseadragon";
import arrowIcon from "./images/arrow.svg?raw";
import showIcon from "./images/eye.svg?raw";
import hideIcon from "./images/hide.svg?raw";
import poiIcon from "./images/poi.svg?raw";
import restartIcon from "./images/restart.svg?raw";
import {
  buildImageUrl,
  chooseImageSize,
  getAnnotationsFromPage,
  getCanvasAnnotationPages,
  getCanvasThumbnailUrl,
  getPageUrl,
  getV2ImageServiceId,
  iiifValueToString,
  isSingleV2Value,
  type RawAnnotation,
} from "./normalise";
import { buildSlides, type Slide } from "./slides";
import { IIIFSaysThisIsHTML, nl2br, sanitiseHTML } from "./utils";

/**
 * Config object used when instantiating a new StoriiiesViewer
 * @property {HTMLElement | Element | string | null} container - The container element where StoriiiesViewer should be mounted. Must exist in the page
 * @property {string} manifestUrl - The URL for the IIIF manifest to be loaded into StoriiiesViewer
 * @property {boolean} showCreditSlide - Whether to show the final credit slide (default: true)
 * @property {boolean} disablePanAndZoom - Whether to disable user panning and zooming (default: false)
 * @property {string} pointOfInterestSvgUrl - URL for a custom SVG to use for points of interest (default: a ring with a dot in the middle)
 * @property {boolean} showThumbnails - Whether to show previews of each image, for jumping between them, when the manifest has more than one (default: true)
 * @property {boolean} showLandingPage - Whether to start with a landing page introducing the story, which replaces the title slide (default: false)
 * @property {string} landingPageEyebrow - Short text shown above the title on the landing page. Use an empty string for none (default: "Exhibit")
 * @property {string} landingPageButtonLabel - Text of the button that starts the story from the landing page (default: "Start Exhibit")
 */
export interface StoriiiesViewerConfig {
  container: HTMLElement | Element | string | null;
  manifestUrl: string;
  showCreditSlide?: boolean;
  disablePanAndZoom?: boolean;
  pointOfInterestSvgUrl?: string;
  showThumbnails?: boolean;
  showLandingPage?: boolean;
  landingPageEyebrow?: string;
  landingPageButtonLabel?: string;
}

type ControlButtons = {
  prev: HTMLButtonElement;
  next: HTMLButtonElement;
};

type statusCodes = {
  [key: string]: ["warn" | "error", string];
};

/** Width in pixels to ask the image service for when making image previews (about double the displayed size, for high density screens) */
const THUMBNAIL_TARGET_WIDTH = 160;

/** Width in pixels to ask the image service for when making the blurred background of the landing page, which doesn't need much detail */
const LANDING_IMAGE_TARGET_WIDTH = 640;

const PRESENTATION_V2_CONTEXT =
  "http://iiif.io/api/presentation/2/context.json";
const PRESENTATION_V3_CONTEXT =
  "http://iiif.io/api/presentation/3/context.json";

type PointOfInterestTarget = {
  type: string;
  source?: string;
  selector: {
    type: "PointSelector";
    x: number;
    y: number;
  };
};

export default class StoriiiesViewer {
  /** Index pointing to the slide currently being viewed */
  #_activeSlideIndex: number = -1;
  /** Index pointing to the canvas from the manifest currently being viewed\
   * This is derived from the active slide, and is used to pick the right image and annotations
   */
  #_activeCanvasIndex: number = 0;
  /** Visibility flag for the infoArea element */
  #_showInfoArea: boolean = true;
  /** Every slide in the story, in order */
  #slides: Slide[] = [];
  /** Set when a different canvas is being opened, so the viewport can be updated once the new image has loaded */
  #canvasSwitchPending: boolean = false;
  /** Cached user preference on reduced-motion */
  #prefersReducedMotion!: boolean;
  /** Error codes and their levels and user facing log messages */
  #statusCodes: statusCodes = {
    "bad-config": ["error", "Missing required config"],
    "manifest-err": ["error", "Encountered a problem loading the manifest"],
    "bad-manifest": ["error", "Could not parse the manifest"],
    "bad-container": ["error", "Container element not found"],
    "unkn-version": [
      "warn",
      "Unsupported IIIF Presentation API version detected",
    ],
    "no-label": [
      "warn",
      "Manifest doesn't contain a label. This is required by the IIIF Presentation API",
    ],
    "ext-anno-err": [
      "warn",
      "Failed to load an externally referenced annotationPage",
    ],
    "no-image-service": [
      "warn",
      "Canvas doesn't have an IIIF image service and was skipped",
    ],
    "poi-svg-err": ["warn", "Failed to load custom POI SVG"],
    "poi-svg-invalid": ["error", "Fetched content is not a valid SVG"],
    "poi-svg-default-err": ["error", "Failed to parse default POI SVG"],
  };
  /** Index representing the number of StoriiiesViewer instances in the current scope */
  static #instanceCounter: number = 0;
  /** The normalised reference to the container where this instance is mounted
   * @readonly
   */
  public containerElement: HTMLElement | null = null;
  /** Whether to display the closing credit slide. Defaults to true, can be overriden in StoriiiesViewerConfig
   * @readonly
   */
  public showCreditSlide: boolean = true;
  /** The URL for the IIIF manifest loaded into this instance */
  public manifestUrl: string;
  /** Whether to disable panning and scrolling */
  public disablePanAndZoom: boolean = false;
  /** Whether to show previews of each image when there is more than one
   * @readonly
   */
  public showThumbnails: boolean = true;
  /** Whether to start with a landing page introducing the story
   * @readonly
   */
  public showLandingPage: boolean = false;
  /** Short text shown above the title on the landing page
   * @readonly
   */
  public landingPageEyebrow: string = "Exhibit";
  /** Text of the button that starts the story from the landing page
   * @readonly
   */
  public landingPageButtonLabel: string = "Start Exhibit";
  /** ID used for creating id attributes that shouldn't clash, or referencing a particular instance of StoriiiesViewer
   * @readonly
   */
  public instanceId: number;
  /** The IIIF manifest loaded into this instance */
  public manifest!: Manifest;
  /** The label retrieved from the manifest */
  public label: string = "";
  /** The summary retrieved from the manifest */
  public summary!: string;
  /** The required statement label and value retrieved from the manifest */
  public requiredStatement!: {
    label: string;
    value: string;
  };
  /** The canvases retrieved from the manifest */
  public canvases!: Canvas[];
  /** The annotationPages retrieved from the manifest, across all canvases */
  public annotationPages: AnnotationPage[] = [];
  /** The annotations for each canvas, in the same order as `canvases` */
  public canvasAnnotations: Array<Array<Annotation>> = [];
  /** The annotations for the current canvas */
  public activeCanvasAnnotations: Array<Annotation> = [];
  /** A reference to the OpenSeadragon viewer */
  public viewer!: OpenSeadragon.Viewer;
  /** A reference to the info-area HTML element
   * @readonly
   */
  public infoAreaElement!: HTMLElement;
  /** A reference to the info-text-area HTML element
   * @readonly
   */
  public infoTextElement!: HTMLElement;
  /** References to the navigation control button HTML elements
   * @readonly
   */
  public controlButtonElements!: ControlButtons;
  /** A reference to the image previews HTML element. Only present when there's more than one image
   * @readonly
   */
  public thumbnailsElement?: HTMLElement;
  /** The landing page, if there is one */
  public landingElement?: HTMLElement;
  /** The button on the landing page that starts the story, if there is one */
  public landingStartButton?: HTMLButtonElement;
  /** A reference to the info-toggle HTML element
   * @readonly
   */
  public infoToggleElement!: HTMLElement;
  /** Reference to the point of interest SVG url
   * @readonly
   */
  public pointOfInterestSvgUrl?: string;
  /** Graphic used for the point of interest markers
   * @readonly
   */
  public pointOfInterestSvg!: SVGElement;
  /** DOMPurify configuration */
  public DOMPurifyConfig: Config = {
    ALLOWED_TAGS: [
      "a",
      "b",
      "br",
      "em",
      "i",
      "p",
      "small",
      "span",
      "strong",
      "sub",
      "sup",
      "img",
      // Common SVG elements
      "svg",
      "path",
      "circle",
      "rect",
      "line",
      "polyline",
      "polygon",
      "ellipse",
      "defs",
      "mask",
      "g",
      "use",
      "text",
      "tspan",
    ],
    ALLOWED_ATTR: ["href", "src", "alt", "class", "id"],
    ADD_ATTR: [
      "viewBox",
      "xmlns",
      "width",
      "height",
      "x",
      "y",
      "cx",
      "cy",
      "r",
      "rx",
      "ry",
      "fill",
      "stroke",
      "stroke-width",
      "stroke-linecap",
      "stroke-linejoin",
      "d",
      "points",
      "transform",
      "xlink:href",
    ],
  };

  constructor(config: StoriiiesViewerConfig) {
    // Normalise the config container
    if (typeof config.container === "string") {
      this.containerElement = document.querySelector(config.container);
      // Allow non-HTMLElements to be fall through as null
      // (e.g. SVG is instanceof Element, but not HTMLElement)
    } else if (config.container instanceof HTMLElement) {
      this.containerElement = config.container;
    }

    // Throw if the container element can't be found (or it's not an HTMLElement)
    if (this.containerElement === null) {
      this.#logger("bad-container", true);
    }

    this.manifestUrl = config.manifestUrl;

    // Use the provided preference if present
    this.showCreditSlide = config.showCreditSlide ?? true;

    this.disablePanAndZoom = config.disablePanAndZoom ?? false;

    this.showThumbnails = config.showThumbnails ?? true;

    this.showLandingPage = config.showLandingPage ?? false;
    this.landingPageEyebrow = config.landingPageEyebrow ?? "Exhibit";
    this.landingPageButtonLabel =
      config.landingPageButtonLabel ?? "Start Exhibit";

    this.pointOfInterestSvgUrl = config.pointOfInterestSvgUrl;

    // Throw if the required config is missing and halt instantiation
    if (!this.containerElement || !this.manifestUrl) {
      this.#logger("bad-config", true);
    }

    // Increment the instance ID if the config is valid
    this.instanceId = StoriiiesViewer.#instanceCounter++;

    this.#prefersReducedMotion = window.matchMedia(
      "(prefers-reduced-motion: reduce)",
    ).matches;

    this.#initManifest().then(() => {
      // Should only get styles if manifest can load
      this.containerElement?.classList.add("storiiies-viewer");
      this.#initViewer();
      this.#insertInfoAndControls();
    });
  }

  /**
   * Log a message to the console, or throw an exception
   */
  #logger(code: string, withException: boolean = false) {
    const [level, message] = this.#statusCodes[code];
    const statuses = new Set(this.containerElement?.dataset.status?.split(","));

    // Primarily for use in the test suites
    if (this.containerElement) {
      statuses.add(code);
      this.containerElement.dataset.status = [...statuses].join(",");
    }

    if (withException) {
      throw new Error(`Storiiies Viewer: ${message}`);
    }

    console[level](`Storiiies Viewer: ${message}`);
  }

  /**
   * Takes a service ID and returns the expanded URL that includes "/info.json"\
   * This format is a MUST for the IIIF Image API, so we can rely on our manipulations being valid
   */
  #expandServiceID(serviceID: string): string {
    // Add "/info.json" to the end of the serviceID
    // replacing trailing slash and/or info.json if present
    return serviceID.replace(/\/?(?:info\.json)?$/, "/info.json");
  }

  /**
   * Load the manifest and extract the label, canvases and annotation pages
   */
  async #initManifest() {
    const rawManifest = await loadManifest(this.manifestUrl).catch(() => {
      this.#logger("manifest-err", true);
    });

    this.manifest = new Manifest(rawManifest);
    const allCanvases: Canvas[] =
      this.manifest.getSequenceByIndex(0)?.getCanvases() ?? [];

    // A valid manifest must have at least one canvas
    // Assume "not a manifest" and throw an error
    if (!allCanvases.length) {
      this.#logger("bad-manifest", true);
    }

    // Only canvases with an IIIF image service can be shown
    this.canvases = allCanvases.filter((canvas: Canvas) => {
      const hasImageService = !!this.#getImageServiceId(canvas);
      if (!hasImageService) this.#logger("no-image-service");
      return hasImageService;
    });

    if (!this.canvases.length) {
      this.#logger("bad-manifest", true);
    }

    // Warn about unsupported manifest versions
    // (Presentation API v2 manifests are converted as they're read, v3 is the native format)
    const contexts: unknown[] = ([] as unknown[]).concat(
      this.manifest.context ?? [],
    );
    if (
      !contexts.some(
        (context) =>
          context === PRESENTATION_V3_CONTEXT ||
          context === PRESENTATION_V2_CONTEXT,
      )
    ) {
      this.#logger("unkn-version");
    }

    this.label = this.#getLabel(this.manifest);

    // At the time of writing, a manifest.getSummary() doesn't exist
    // v2 manifests have a "description" instead
    this.summary =
      this.manifest.getProperty("summary")?.en?.[0] ||
      iiifValueToString(this.manifest.getProperty("description")) ||
      "";
    let requiredStatementLabel;
    let requiredStatementValue;

    try {
      requiredStatementLabel = this.manifest
        ?.getRequiredStatement()
        ?.getLabel();
    } catch (e) {
      // Ignore
    }
    try {
      requiredStatementValue = this.manifest
        ?.getRequiredStatement()
        ?.getValue();
    } catch (e) {
      // Ignore
    }

    this.requiredStatement = {
      label: requiredStatementLabel || "",
      // v2 manifests have an "attribution" instead
      value:
        requiredStatementValue ||
        iiifValueToString(this.manifest.getProperty("attribution")) ||
        "",
    };

    // It's worth noting display of a title slide is predicated on the presence of a label in the manifest
    // Without one there's no title slide, but we should also warn that this is invalid
    if (!this.label) {
      this.#logger("no-label");
    }

    await this.#loadAnnotations();
    this.activeCanvasAnnotations = this.canvasAnnotations[0] ?? [];
    this.#slides = this.#buildSlides();
  }

  /**
   * Get the label of a canvas, if it has one
   */
  #getCanvasLabel(canvasIndex: number): string {
    return this.#getLabel(this.canvases[canvasIndex]);
  }

  /**
   * Get the label of a manifest or canvas as plain text
   */
  #getLabel(resource: Manifest | Canvas): string {
    try {
      // A lone v2 style { "@value", "@language" } object isn't something every
      // language map parser copes with, so read those directly
      const rawLabel = resource.getProperty("label");
      if (isSingleV2Value(rawLabel)) {
        return iiifValueToString(rawLabel);
      }
      return resource.getLabel().getValue() || "";
    } catch (e) {
      return "";
    }
  }

  /**
   * Get the description of a manifest or canvas as plain text
   */
  #getDescription(resource: Manifest | Canvas): string {
    try {
      // A lone v2 style { "@value", "@language" } object isn't something every
      // language map parser copes with, so read those directly
      const rawLabel = resource.getProperty("description");
      if (isSingleV2Value(rawLabel)) {
        return iiifValueToString(rawLabel);
      }
      return resource.getLabel().getValue() || "";
    } catch (e) {
      return "";
    }
  }

  /**
   * Get the description of a manifest or canvas as plain text
   */
  #getAttribution(resource: Manifest | Canvas): string {
    try {
      // A lone v2 style { "@value", "@language" } object isn't something every
      // language map parser copes with, so read those directly
      const rawLabel = resource.getProperty("attribution");
      if (isSingleV2Value(rawLabel)) {
        return iiifValueToString(rawLabel);
      }
      return resource.getLabel().getValue() || "";
    } catch (e) {
      return "";
    }
  }

  /**
   * Get the id of the IIIF image service for a canvas\
   * Falls back to reading v2 canvases directly
   */
  #getImageServiceId(canvas: Canvas): string | undefined {
    let serviceId: string | undefined;
    try {
      serviceId = canvas.imageServiceIds?.[0];
    } catch (e) {
      // Ignore, and try the fallback
    }
    return (
      serviceId || getV2ImageServiceId({ images: canvas.getProperty("images") })
    );
  }

  /**
   * Work out every slide in the story\
   * Title slide, then each canvas's annotations in turn, then credits
   */
  #buildSlides(): Slide[] {
    return buildSlides({
      hasLanding: this.showLandingPage,
      hasTitle: !!this.label,
      showCredits: this.showCreditSlide,
      canvases: this.canvases.map((_, canvasIndex) => ({
        annotationCount: this.canvasAnnotations[canvasIndex].length,
        hasLabel: !!this.#getCanvasLabel(canvasIndex),
      })),
    });
  }

  /**
   * Initialize the viewer
   */
  #initViewer() {
    const osdContainer = document.createElement("div");
    osdContainer.id = `storiiies-viewer-${this.instanceId}__osd-container`;
    osdContainer.classList.add("storiiies-viewer__osd-container");
    this.containerElement?.insertAdjacentElement("afterbegin", osdContainer);
    if (this.containerElement) {
      this.containerElement.dataset.activeCanvas =
        this.activeCanvasIndex.toString();
    }
    this.viewer = OpenSeadragon({
      element: osdContainer,
      tileSources: [this.#getTileSource(this.activeCanvasIndex)],
      crossOriginPolicy: "Anonymous",
      showSequenceControl: false,
      showHomeControl: false,
      showZoomControl: false,
      showFullPageControl: false,
      visibilityRatio: 0.3,
      mouseNavEnabled: !this.disablePanAndZoom,
    });

    this.viewer.canvas.ariaLabel = "Storiiies viewer";
    this.viewer.canvas.role = "application";
    this.viewer.element.insertAdjacentHTML(
      "afterbegin",
      `<p class="storiiies-viewer__description" id="storiiies-viewer-${this.instanceId}__description">Drag with your mouse or the arrow keys, and zoom with scroll or <kbd aria-label="plus">+</kbd> and <kbd aria-label="minus">-</kbd></p>`,
    );
    this.viewer.canvas.setAttribute(
      "aria-describedby",
      `storiiies-viewer-${this.instanceId}__description`,
    );

    // After the image has loaded
    this.viewer.addHandler("open", () => {
      if (this.containerElement) {
        this.containerElement.dataset.loaded = "true";
        // Remove any existing points of interest and re-render
        this.viewer.clearOverlays();
        this.#renderPointsOfInterest().then(() => {
          this.#updatePointOfInterestMarkers();
        });

        // A different image has just loaded, so bring the viewport to the active slide
        if (this.#canvasSwitchPending) {
          this.#canvasSwitchPending = false;
          this.#updateViewer();
        }
      }
    });
  }

  /**
   * Get the OpenSeadragon tile source for a canvas
   */
  #getTileSource(canvasIndex: number): string {
    return this.#expandServiceID(
      this.#getImageServiceId(this.canvases[canvasIndex]) ?? "",
    );
  }

  /**
   * Replace the image in the viewer with the one for a different canvas
   */
  #openCanvas(canvasIndex: number) {
    this.#_activeCanvasIndex = canvasIndex;
    this.activeCanvasAnnotations = this.canvasAnnotations[canvasIndex] ?? [];
    this.#canvasSwitchPending = true;

    if (this.containerElement) {
      this.containerElement.dataset.loaded = "false";
      this.containerElement.dataset.activeCanvas = canvasIndex.toString();
    }

    // The "open" handler takes care of points of interest and the viewport
    this.viewer.open(this.#getTileSource(canvasIndex));
  }

  /**
   * Set the point of interest SVG graphic\
   * Fetches from a URL if provided, otherwise uses the default SVG
   */
  async #setPointOfInterestSvg() {
    // Already set (e.g. when returning to or moving between canvases)
    if (this.pointOfInterestSvg) return;

    if (this.pointOfInterestSvgUrl) {
      try {
        const response = await fetch(this.pointOfInterestSvgUrl);
        if (!response.ok) {
          throw new Error(`Failed to fetch SVG: ${response.statusText}`);
        }
        const svgText = await response.text();

        // Sanitize and return as DOM element
        const sanitized = DOMPurify.sanitize(svgText, {
          ...this.DOMPurifyConfig,
          RETURN_DOM_FRAGMENT: true,
        });

        const svgElement = sanitized.querySelector("svg");

        if (!svgElement) {
          this.#logger("poi-svg-invalid", true);
          return;
        }

        this.pointOfInterestSvg = svgElement;
      } catch (error) {
        this.#logger("poi-svg-err");
        // Fall back to default on error
        this.#setDefaultPointOfInterestSvg();
      }
    } else {
      this.#setDefaultPointOfInterestSvg();
    }
  }

  /**
   * Set default POI SVG graphic
   */
  #setDefaultPointOfInterestSvg() {
    const parser = new DOMParser();
    const doc = parser.parseFromString(poiIcon, "image/svg+xml");
    const svgElement = doc.querySelector("svg");

    if (svgElement) {
      this.pointOfInterestSvg = svgElement;
    } else {
      this.#logger("poi-svg-default-err", true);
    }
  }

  /**
   * Rendering of points of interest on the viewer
   */
  async #renderPointsOfInterest() {
    // The canvas may change while the SVG is loading
    const canvasIndex = this.#_activeCanvasIndex;

    // Assign point of interest marker SVG
    await this.#setPointOfInterestSvg();

    // Don't render markers for an image that's no longer being shown
    if (canvasIndex !== this.#_activeCanvasIndex) return;

    // Extract POI data from annotations
    const poiData = this.activeCanvasAnnotations.map((annotation, index) => {
      // TODO: Cast needed here until manifesto.js updates return type of getTarget()
      const target = annotation.getTarget() as
        | string
        | null
        | PointOfInterestTarget;
      if (this.#isPointOfInterestTarget(target)) {
        return {
          index,
          x: target.selector.x,
          y: target.selector.y,
        };
      }
    });

    poiData.forEach((poi) => {
      if (poi) {
        // Render HTML element for each POI
        const poiButton = document.createElement("button");
        poiButton.type = "button";
        poiButton.appendChild(this.pointOfInterestSvg.cloneNode(true));
        poiButton.classList.add(
          "storiiies-viewer__icon-button",
          "storiiies-viewer__poi-marker",
        );
        poiButton.dataset.poiIndex = poi.index.toString();
        poiButton.ariaLabel = `Point of interest ${poi.index + 1}`;

        // Having a click event on an overlay requires a bit of extra legwork
        new OpenSeadragon.MouseTracker({
          element: poiButton,
          // Allow deferring to the native click callback as this runs anyway
          clickHandler: () => {},
        });

        // For keyboard actuations as well as mouse clicks
        poiButton.addEventListener("click", () => {
          this.activeAnnotationIndex = poi.index;
        });

        // Try to counteract odd behaviour if focus moves to an out of view POI
        poiButton.addEventListener("focus", () => {
          // Delay to ensure focus movement happens after blur event
          setTimeout(() => {
            this.viewer.viewport.fitBoundsWithConstraints(
              this.viewer.viewport.imageToViewportRectangle(
                poi.x,
                poi.y,
                100,
                100,
              ),
              true,
            );
          }, 0);
        });

        // Return to home when POI loses focus
        // Counteract odd canvas rendering on keyboard navigation
        poiButton.addEventListener("blur", () => {
          this.viewer.viewport.goHome(true);
        });

        // Attach POI to viewer as an OSD overlay
        this.viewer.addOverlay({
          element: poiButton,
          location: this.viewer.viewport.imageToViewportCoordinates(
            poi.x,
            poi.y,
          ),
          checkResize: false,
        });
      }
    });
  }

  /**
   * Verify that a target is a PointOfInterestTarget\
   * Type guard function
   * @param target
   * @returns boolean
   */
  #isPointOfInterestTarget(target: unknown): target is PointOfInterestTarget {
    if (typeof target !== "object" || target === null) {
      return false;
    }
    const t = target as PointOfInterestTarget;
    return (
      t.selector.type === "PointSelector" &&
      typeof t.selector.x === "number" &&
      typeof t.selector.y === "number"
    );
  }

  /**
   * Transform a PointOfInterestTarget to a region string\
   * This should be consumable by #getRegion
   * @param target
   * @returns string
   */
  #transformPointOfInterestToRegion(target: PointOfInterestTarget) {
    // Define a region around the point
    const regionSize = 100;

    const x = Math.max(0, target.selector.x - regionSize / 2);
    const y = Math.max(0, target.selector.y - regionSize / 2);
    return `#xywh=${x},${y},${regionSize},${regionSize}`;
  }

  /**
   * Set the active point of interest marker on the viewer
   **/
  #updatePointOfInterestMarkers() {
    const poiMarkers = this.viewer.canvas.querySelectorAll(
      ".storiiies-viewer__poi-marker",
    );
    // Remove active state from all markers
    poiMarkers.forEach((marker) => {
      marker.classList.remove("storiiies-viewer___poi-marker--active");
    });

    const slide = this.#slides[this.#_activeSlideIndex];

    if (
      slide?.type === "annotation" &&
      slide.annotationIndex < this.activeCanvasAnnotations.length &&
      this.#isPointOfInterestTarget(
        this.activeCanvasAnnotations[slide.annotationIndex].getTarget(),
      )
    ) {
      const activeMarker = this.viewer.canvas.querySelector(
        '.storiiies-viewer__poi-marker[data-poi-index="' +
          slide.annotationIndex +
          '"]',
      );
      if (activeMarker) {
        activeMarker.classList.add("storiiies-viewer___poi-marker--active");
      }
    }
  }

  /**
   * Offset region coordinates to compensate for info area\
   * This should be performed on raw values before conversion into any coordinate system
   * @param region OpenSeadragon rectangle representing region
   * @returns OpenSeadragon rectangle with adjusted coordinates
   */
  #offSetRegionByInfoArea(region: OpenSeadragon.Rect): OpenSeadragon.Rect {
    let x = region.x;
    // Space taken by info area
    let infoAreaWidth = this.infoAreaElement.offsetWidth;
    // Available space in viewer
    const viewerWidth = this.viewer.container.clientWidth;
    const halfViewerWidth = viewerWidth / 2;
    const infoInset = this.containerElement
      ? parseFloat(
          getComputedStyle(this.containerElement).getPropertyValue(
            "--storiiies-viewer-outer-spacing",
          ),
        ) || 0
      : 0;

    infoAreaWidth += infoInset;

    // Space taken by the image previews, which sit on the opposite side to the info area
    const thumbnailsWidth = this.thumbnailsElement
      ? this.thumbnailsElement.offsetWidth + infoInset
      : 0;

    const overlap = infoAreaWidth - halfViewerWidth;
    const remainingSpace = viewerWidth - infoAreaWidth - thumbnailsWidth;
    const poiButtonWidth = 44;

    // The new focal point becomes the centre of the remaining space
    x -= overlap + remainingSpace / 2 - poiButtonWidth / 2;

    return new OpenSeadragon.Rect(x, region.y, region.width, region.height);
  }

  /**
   * Update the viewer
   */
  #updateViewer() {
    const slide = this.#slides[this.#_activeSlideIndex];
    if (!slide) return;

    // Show whole image on the landing page and title slide, when introducing an image, and when recapping one
    if (
      slide.type === "landing" ||
      slide.type === "title" ||
      slide.type === "canvas" ||
      slide.type === "overview"
    ) {
      this.viewer.viewport.goHome(this.#prefersReducedMotion);
      return;
    }

    // Do nothing on the credit slide
    if (slide.type === "credits") {
      return;
    }

    let target =
      this.activeCanvasAnnotations[slide.annotationIndex].getTarget() || "";

    // Flatten a point of interest into something the viewer can fit to the screen
    const isPointOfInterest = this.#isPointOfInterestTarget(target);
    if (this.#isPointOfInterestTarget(target)) {
      target = this.#transformPointOfInterestToRegion(target);
    }

    let region = this.#getRegion(target);
    if (region) {
      // Adjust region under certain conditions
      if (
        isPointOfInterest &&
        this.showInfoArea &&
        this.viewer.container.clientWidth >= 640
      ) {
        region = this.#offSetRegionByInfoArea(region);
      }

      this.viewer.viewport.fitBoundsWithConstraints(
        this.viewer.viewport.imageToViewportRectangle(region),
        this.#prefersReducedMotion,
      );
    } else {
      this.viewer.viewport.goHome(this.#prefersReducedMotion);
    }
  }

  /**
   * Get the active canvas index\
   * Used to determine which canvas (image) is currently active
   */
  get activeCanvasIndex(): number {
    return this.#_activeCanvasIndex;
  }

  /**
   * Set the active canvas index and perform any necessary updates\
   * Used to navigate between canvases, moving to the first slide for that canvas
   */
  set activeCanvasIndex(index: number) {
    // The landing page isn't part of any image, so jumping to an image goes past it
    const slideIndex = this.#slides.findIndex(
      (slide) => slide.canvasIndex === index && slide.type !== "landing",
    );
    if (slideIndex !== -1) {
      this.activeSlideIndex = slideIndex;
    }
  }

  /**
   * Get the active annotation index\
   * This is the position of the active annotation within the active canvas's annotations,
   * or -1 if the active slide isn't an annotation (e.g. the title or credit slide)
   */
  get activeAnnotationIndex(): number {
    const slide = this.#slides[this.#_activeSlideIndex];
    return slide?.type === "annotation" ? slide.annotationIndex : -1;
  }

  /**
   * Set the active annotation index (within the active canvas) and perform any necessary updates\
   * Used to navigate between annotations
   */
  set activeAnnotationIndex(index: number) {
    const slideIndex = this.#slides.findIndex(
      (slide) =>
        slide.type === "annotation" &&
        slide.canvasIndex === this.#_activeCanvasIndex &&
        slide.annotationIndex === index,
    );
    if (slideIndex !== -1) {
      this.activeSlideIndex = slideIndex;
    }
  }

  /**
   * Get the active slide index\
   * Slides are, in order: the title, each canvas's annotations, and the credits
   */
  get activeSlideIndex(): number {
    return this.#_activeSlideIndex;
  }

  /**
   * Set the active slide index and perform any necessary updates\
   * Used to navigate between slides, switching images where needed
   */
  set activeSlideIndex(index: number) {
    // Ignore out of bounds values
    if (index < 0 || index >= this.#slides.length) return;

    const lowerBound = 0;
    const upperBound = this.#slides.length - 1;
    const slide = this.#slides[index];
    // Undefined when first setting up
    const previousSlide = this.#slides[this.#_activeSlideIndex];
    let infoTextElementMarkup;

    this.#_activeSlideIndex = index;

    // Reset button states
    this.controlButtonElements.prev.disabled = false;
    this.controlButtonElements.next.innerHTML = `<span class="storiiies-viewer__button-icon" inert>${arrowIcon}</span>`;
    this.controlButtonElements.next.ariaLabel = "Next";

    // Update buttons
    if (index === lowerBound) {
      this.controlButtonElements.prev.disabled = true;
    }

    if (index === upperBound) {
      this.controlButtonElements.next.innerHTML = `<span class="storiiies-viewer__button-icon" inert>${restartIcon}</span>`;
      this.controlButtonElements.next.ariaLabel = "Restart";
    }

    // Annotations need to be those of the new slide's canvas before rendering the text
    const canvasChanged = slide.canvasIndex !== this.#_activeCanvasIndex;
    if (canvasChanged) {
      this.#_activeCanvasIndex = slide.canvasIndex;
      this.activeCanvasAnnotations =
        this.canvasAnnotations[slide.canvasIndex] ?? [];
    }

    // Determine rendering method for info text area
    switch (slide.type) {
      case "landing":
        // Nothing to show in the info area, as the landing page covers it
        infoTextElementMarkup = "";
        break;
      case "title":
        infoTextElementMarkup = this.#creatTitleSlideMarkup();
        break;
      case "canvas":
      case "overview":
        infoTextElementMarkup = this.#createCanvasSlideMarkup(
          slide.canvasIndex,
        );
        break;
      case "credits":
        infoTextElementMarkup = this.#createCreditSlideMarkup();
        break;
      default:
        infoTextElementMarkup = this.#createAnnotationSlideMarkup();
    }

    this.infoTextElement.innerHTML = infoTextElementMarkup;

    this.#updateThumbnails();
    this.#updateLandingPage(slide.type === "landing", previousSlide);

    if (canvasChanged) {
      // Swap the image. Markers and viewport are updated when it has loaded
      this.#openCanvas(slide.canvasIndex);
    } else {
      this.#updatePointOfInterestMarkers();
      this.#updateViewer();
    }
  }

  /**
   * Get the showInfoArea value\
   * Used to determine whether the info area is visible
   */
  get showInfoArea(): boolean {
    return this.#_showInfoArea;
  }

  /**
   * Set the showInfoArea value and perform any necessary updates\
   * Used to toggle the info area visibility
   */
  set showInfoArea(value: boolean) {
    this.#_showInfoArea = value;
    this.containerElement?.classList.toggle(
      "storiiies-viewer--info-hidden",
      !value,
    );
    this.infoToggleElement.ariaLabel = `${value ? "Hide" : "Show"} annotations`;
    this.infoToggleElement.innerHTML = `
      <span class="storiiies-viewer__button-icon" inert>
        ${value ? hideIcon : showIcon}
      </span>
    `;
    this.infoToggleElement.ariaExpanded = `${value}`;
    this.infoAreaElement.inert = !value;
    this.infoAreaElement.classList.toggle(
      "storiiies-viewer__info-area--hidden",
      !value,
    );
  }

  /**
   * Create area for label, annotations and controls
   */
  #insertInfoAndControls() {
    const infoAreaEl = document.createElement("div");
    const prevButtonEl = document.createElement("button");
    const infoToggleEl = document.createElement("button");

    // Navigation buttons
    prevButtonEl.id = `storiiies-viewer-${this.instanceId}__previous`;
    prevButtonEl.classList.add("storiiies-viewer__icon-button");
    prevButtonEl.ariaLabel = "Previous";
    prevButtonEl.innerHTML = `
      <span class="storiiies-viewer__button-icon" inert>
        ${arrowIcon}
      </span>
    `;

    // (Next button innerHTML updated when activeAnnotationIndex changes)
    const nextButtonEl = prevButtonEl.cloneNode() as HTMLButtonElement;
    nextButtonEl.id = `storiiies-viewer-${this.instanceId}__next`;

    prevButtonEl.classList.add("storiiies-viewer__previous");
    nextButtonEl.classList.add("storiiies-viewer__next");

    [prevButtonEl, nextButtonEl].forEach((button) => {
      button.addEventListener("click", (e) => {
        if ((e.target as HTMLButtonElement).ariaLabel === "Previous") {
          this.activeSlideIndex = this.activeSlideIndex - 1;
        } else {
          if (this.activeSlideIndex === this.#slides.length - 1) {
            // Restart
            this.activeSlideIndex = 0;
          } else {
            this.activeSlideIndex = this.activeSlideIndex + 1;
          }
        }
      });
    });
    infoAreaEl.append(prevButtonEl, nextButtonEl);

    // Text element
    infoAreaEl.insertAdjacentHTML(
      "beforeend",
      `
      <div id="storiiies-viewer-${this.instanceId}__info-text" class="storiiies-viewer__info-text" tabindex="0">
      </div>
    `,
    );
    const infoTextEl = infoAreaEl.querySelector(
      ".storiiies-viewer__info-text",
    ) as HTMLElement;

    // Toggle button
    infoToggleEl.id = `storiiies-viewer-${this.instanceId}__info-toggle`;
    infoToggleEl.classList.add(
      "storiiies-viewer__icon-button",
      "storiiies-viewer__info-toggle",
    );
    infoToggleEl.setAttribute(
      "aria-controls",
      `storiiies-viewer-${this.instanceId}__info-area`,
    );
    infoToggleEl.addEventListener("click", () => {
      this.showInfoArea = !this.showInfoArea;
    });

    // Info area container
    infoAreaEl.id = `storiiies-viewer-${this.instanceId}__info-area`;
    this.containerElement?.insertAdjacentElement("beforeend", infoAreaEl);
    infoAreaEl.insertAdjacentElement("beforebegin", infoToggleEl);
    infoAreaEl.classList.add("storiiies-viewer__info-area");

    // Register elements
    this.infoAreaElement = infoAreaEl;
    this.infoTextElement = infoTextEl;
    this.controlButtonElements = {
      prev: prevButtonEl,
      next: nextButtonEl,
    };
    this.infoToggleElement = infoToggleEl;

    this.#insertThumbnails();
    this.#insertLandingPage();

    // Initialise values, let the setters handle the rest
    this.showInfoArea = true;
    this.activeSlideIndex = 0;
  }

  /**
   * Create the landing page, which introduces the story before it starts\
   * It's a layer over the whole viewer, with a blurred copy of the first image behind the title
   */
  #insertLandingPage() {
    if (!this.showLandingPage || !this.containerElement) return;

    const landingEl = document.createElement("div");
    landingEl.id = `storiiies-viewer-${this.instanceId}__landing`;
    landingEl.classList.add("storiiies-viewer__landing");
    landingEl.setAttribute("role", "region");
    landingEl.ariaLabel = "Introduction";

    // Blurred copy of the first image. Purely decorative, and not essential, so it's added when it's ready
    const imageEl = document.createElement("img");
    imageEl.classList.add("storiiies-viewer__landing-image");
    imageEl.alt = "";
    imageEl.setAttribute("aria-hidden", "true");
    imageEl.addEventListener("load", () => {
      imageEl.dataset.loaded = "true";
    });
    landingEl.append(imageEl);
    this.#getThumbnailUrl(0, LANDING_IMAGE_TARGET_WIDTH).then((url) => {
      if (url) imageEl.src = url;
    });

    const contentEl = document.createElement("div");
    contentEl.classList.add("storiiies-viewer__landing-content");

    // Text provided in the config is always plain text
    if (this.landingPageEyebrow) {
      const eyebrowEl = document.createElement("p");
      eyebrowEl.classList.add("storiiies-viewer__landing-eyebrow");
      eyebrowEl.textContent = this.landingPageEyebrow;
      contentEl.append(eyebrowEl);
    }

    // Everything from the manifest is sanitised, in the same way as on the title slide
    if (this.label) {
      const titleEl = document.createElement("h1");
      titleEl.classList.add("storiiies-viewer__landing-title");
      titleEl.innerHTML = sanitiseHTML(nl2br(this.label), this.DOMPurifyConfig);
      contentEl.append(titleEl);
    }

    if (this.summary) {
      const summaryEl = document.createElement("div");
      summaryEl.classList.add("storiiies-viewer__landing-summary");
      summaryEl.innerHTML = sanitiseHTML(
        IIIFSaysThisIsHTML(this.summary) ? this.summary : nl2br(this.summary),
        this.DOMPurifyConfig,
      );
      contentEl.append(summaryEl);
    }

    // Only the value of the required statement, so it reads as a byline
    if (this.requiredStatement.value) {
      const bylineEl = document.createElement("div");
      bylineEl.classList.add("storiiies-viewer__landing-byline");
      bylineEl.innerHTML = sanitiseHTML(
        IIIFSaysThisIsHTML(this.requiredStatement.value)
          ? this.requiredStatement.value
          : nl2br(this.requiredStatement.value),
        this.DOMPurifyConfig,
      );
      contentEl.append(bylineEl);
    }

    const startButtonEl = document.createElement("button");
    startButtonEl.id = `storiiies-viewer-${this.instanceId}__landing-start`;
    startButtonEl.type = "button";
    startButtonEl.classList.add("storiiies-viewer__landing-start");
    const startLabelEl = document.createElement("span");
    startLabelEl.textContent = this.landingPageButtonLabel;
    startButtonEl.append(startLabelEl);
    startButtonEl.insertAdjacentHTML(
      "beforeend",
      `<span class="storiiies-viewer__button-icon" inert>${arrowIcon}</span>`,
    );
    startButtonEl.addEventListener("click", () => {
      this.activeSlideIndex = this.activeSlideIndex + 1;
    });
    contentEl.append(startButtonEl);

    landingEl.append(contentEl);
    this.containerElement.insertAdjacentElement("beforeend", landingEl);

    this.landingElement = landingEl;
    this.landingStartButton = startButtonEl;
  }

  /**
   * Show or hide the landing page, depending on the active slide\
   * While it's showing, the rest of the viewer is hidden and can't be interacted with
   */
  #updateLandingPage(isLanding: boolean, previousSlide?: Slide) {
    const landingEl = this.landingElement;
    if (!landingEl) return;

    landingEl.dataset.visible = `${isLanding}`;
    landingEl.inert = !isLanding;
    this.containerElement?.classList.toggle(
      "storiiies-viewer--landing",
      isLanding,
    );
    // Keep keyboard users away from the image while it's covered
    this.viewer.element.inert = isLanding;

    // The element with focus is about to be hidden, so move focus somewhere sensible
    // (but not when the viewer is first being set up, as that would steal focus from the page)
    if (previousSlide) {
      if (isLanding) {
        this.landingStartButton?.focus();
      } else if (previousSlide.type === "landing") {
        this.controlButtonElements.next.focus();
      }
    }
  }

  /**
   * Get the URL of an image to use as a preview of a canvas\
   * Uses the canvas's own thumbnail if it has one, otherwise asks its image service for a suitable size
   */
  async #getThumbnailUrl(
    canvasIndex: number,
    targetWidth: number = THUMBNAIL_TARGET_WIDTH,
  ): Promise<string | undefined> {
    const canvas = this.canvases[canvasIndex];

    const provided = getCanvasThumbnailUrl({
      thumbnail: canvas.getProperty("thumbnail"),
    });
    if (provided) return this.#resolveUrl(provided);

    const serviceId = this.#getImageServiceId(canvas);
    if (!serviceId) return undefined;

    // Level 0 image services only deliver the sizes they list in their info.json
    let width = targetWidth;
    try {
      const response = await fetch(this.#expandServiceID(serviceId));
      if (response.ok) {
        const info = await response.json();
        width = chooseImageSize(info?.sizes, width) ?? width;
      }
    } catch (e) {
      // Ignore, and ask for the target width anyway
    }

    return buildImageUrl(serviceId, width);
  }

  /**
   * Create the previews of each image, used to jump between them\
   * Only needed when there's more than one image
   */
  #insertThumbnails() {
    if (!this.showThumbnails || this.canvases.length < 2) return;

    const thumbnailsEl = document.createElement("nav");
    thumbnailsEl.id = `storiiies-viewer-${this.instanceId}__thumbnails`;
    thumbnailsEl.classList.add("storiiies-viewer__thumbnails");
    thumbnailsEl.ariaLabel = "Images";

    this.canvases.forEach((_, canvasIndex) => {
      const label = this.#getCanvasLabel(canvasIndex);
      const position = `Image ${canvasIndex + 1} of ${this.canvases.length}`;

      const button = document.createElement("button");
      button.type = "button";
      button.classList.add("storiiies-viewer__thumbnail");
      button.dataset.canvasIndex = canvasIndex.toString();
      button.ariaLabel = label ? `${position}: ${label}` : position;
      button.title = label || `Image ${canvasIndex + 1}`;

      // Jump to the start of that image's part of the story
      button.addEventListener("click", () => {
        this.activeCanvasIndex = canvasIndex;
      });

      thumbnailsEl.append(button);

      // The image itself can arrive whenever. The button works without it
      this.#getThumbnailUrl(canvasIndex).then((url) => {
        if (!url) return;
        const img = document.createElement("img");
        // The button is already labelled
        img.alt = "";
        img.draggable = false;
        img.src = url;
        button.append(img);
      });
    });

    this.containerElement?.insertAdjacentElement("beforeend", thumbnailsEl);
    this.thumbnailsElement = thumbnailsEl;
  }

  /**
   * Mark the preview of the active image, and scroll it into view in the list
   */
  #updateThumbnails() {
    const thumbnailsEl = this.thumbnailsElement;
    if (!thumbnailsEl) return;

    thumbnailsEl
      .querySelectorAll<HTMLButtonElement>(".storiiies-viewer__thumbnail")
      .forEach((button) => {
        const isActive =
          button.dataset.canvasIndex === this.#_activeCanvasIndex.toString();

        if (isActive) {
          button.setAttribute("aria-current", "true");

          // Scroll the list itself, rather than scrollIntoView which could also scroll the page
          thumbnailsEl.scrollTo({
            top:
              button.offsetTop -
              (thumbnailsEl.clientHeight - button.offsetHeight) / 2,
            behavior: this.#prefersReducedMotion ? "auto" : "smooth",
          });
        } else {
          button.removeAttribute("aria-current");
        }
      });
  }

  /**
   * Generate HTML markup for the title slide
   */
  #creatTitleSlideMarkup(): string {
    // Label should always be plain text
    const labelHTML = sanitiseHTML(nl2br(this.label), this.DOMPurifyConfig);

    // Summary might be plain text or HTML
    const summaryHTML = sanitiseHTML(
      IIIFSaysThisIsHTML(this.summary) ? this.summary : nl2br(this.summary),
      this.DOMPurifyConfig,
    );
    let requiredStatementHTML = "";

    requiredStatementHTML = sanitiseHTML(
      requiredStatementHTML.concat(
        this.requiredStatement.label &&
          `<strong>${this.requiredStatement.label}:</strong> `,
        // Required statement value might be plain text or HTML
        this.requiredStatement.value &&
          `${
            IIIFSaysThisIsHTML(this.requiredStatement.value)
              ? this.requiredStatement.value
              : nl2br(this.requiredStatement.value)
          }`,
      ),
      this.DOMPurifyConfig,
    );

    // N.B. Sanitising this whole chunk would require loosening restrictions on allowed tags and attributes
    return `
        <h1 class="storiiies-viewer__title storiiies-viewer__text-section">${labelHTML}</h1>
        <div class="storiiies-viewer__text-section">${summaryHTML}</div>
        <div class="storiiies-viewer__text-section">${requiredStatementHTML}</div>
      `;
  }

  /**
   * Generate HTML markup for the slides that introduce an image after the first, and recap an image
   */
  #createCanvasSlideMarkup(canvasIndex: number): string {
    // Label should always be plain text
    const labelHTML = sanitiseHTML(
      nl2br(this.#getCanvasLabel(canvasIndex) || `Image ${canvasIndex + 1}`),
      this.DOMPurifyConfig,
    );

    return `<h2 class="storiiies-viewer__title storiiies-viewer__text-section">${labelHTML}</h2>`;
  }

  /**
   * Generate HTML markup for an annotation slide
   */
  #createAnnotationSlideMarkup(): string {
    let markup = "";
    const slide = this.#slides[this.#_activeSlideIndex];
    const activeAnnotation =
      slide.type === "annotation"
        ? this.activeCanvasAnnotations[slide.annotationIndex].getBody()
        : [];

    // getBody will always return AnnotationBody[]
    for (const body of activeAnnotation) {
      // Wrap each annotation in a div
      markup += `<div class="storiiies-viewer__text-section">`;
      if (body.getType() === "textualbody") {
        let value = body.getProperty("value");
        const format = body.getFormat() || "text/plain";

        // Replace newlines with break tags for plain text
        if (format === "text/plain") {
          value = value.replace(/(?:\r\n|\r|\n)/g, "<br/>");
        }

        // Sanitize the value (e.g. it may be text/html)
        markup += sanitiseHTML(value, this.DOMPurifyConfig);
      } else if (body.getType() === "sound") {
        const soundUrl = body.id;
        // Create the audio link and sanitize the src
        const audioElement = `<audio controls src="${sanitiseHTML(
          soundUrl,
          this.DOMPurifyConfig,
        )}">Your browser does not support the audio element.</audio>`;
        markup += audioElement;
      }
      markup += "</div>";
    }

    // The return value isn't sanitised to avoid needing to open up the allowed tags and attributes
    // Remember to sanitise your values when extending this!
    return markup;
  }

  /**
   * Generate HTML markup for an annotation slide
   */
  #createCreditSlideMarkup(): string {
    // No need to sanitise this hardcoded markup
    return `<div class="storiiies-viewer__text-section"><p>View more programming and resources about this exhibit at <a href="https://www.cooperhewitt.org" target="_blank">cooperhewitt.org</a>.</p></div>`;
    //return `<div class="storiiies-viewer__text-section"><p>Storiiies was created by <a href="https://www.cogapp.com" target="_blank">Cogapp</a>.</p><p>It's easy, and free, to create your own story - find out more at <a href="https://www.cogapp.com/storiiies" target="_blank">cogapp.com/storiiies</a>.</p><p>This viewer is released as open source - see <a href="https://cogapp.com/open-source-at-cogapp" target="_blank">cogapp.com/open-source-at-cogapp</a>.</p></div>`;
  }

  /**
   * Resolve a URL found in the manifest relative to the manifest's own URL
   */
  #resolveUrl(url: string): string {
    try {
      return new URL(url, new URL(this.manifestUrl, document.baseURI).href)
        .href;
    } catch (e) {
      return url;
    }
  }

  /**
   * Fetch an externally referenced annotation page (v3) or annotation list (v2)\
   * Resolves to its annotations, or an empty array (with a warning) if it can't be used
   */
  async #fetchAnnotations(url: string): Promise<RawAnnotation[]> {
    try {
      const response = await fetch(this.#resolveUrl(url));
      if (!response.ok) {
        throw new Error(`Failed to fetch annotations: ${response.statusText}`);
      }
      const annotations = getAnnotationsFromPage(await response.json());
      if (!annotations) {
        throw new Error("Fetched content is not an annotation page");
      }
      return annotations;
    } catch (e) {
      this.#logger("ext-anno-err");
      return [];
    }
  }

  /**
   * Retrieves the annotations for each canvas in the manifest\
   * Handles v3 `annotations` and v2 `otherContent`, whether embedded or referenced externally.
   * Populates `canvasAnnotations` (annotations per canvas) and `annotationPages` (all pages)\
   * (Temporary solution)
   */
  async #loadAnnotations() {
    const pagesPerCanvas = await Promise.all(
      this.canvases.map((canvas) => {
        // "getProperty" ejects and results in raw JSON
        // We need to instantiate each level with the appropriate constructor
        const rawPages = getCanvasAnnotationPages({
          annotations: canvas.getProperty("annotations"),
          otherContent: canvas.getProperty("otherContent"),
        });

        // Pages for a canvas are loaded in parallel, and kept in manifest order
        return Promise.all(
          rawPages.map((rawPage) => this.#createAnnotationPage(rawPage)),
        );
      }),
    );

    this.annotationPages = pagesPerCanvas.flat();

    // A canvas might have several annotationPages, which are shown in order
    // TODO: Deprecation warning from manifesto.js on getItems
    // but switching to getAnnotations seems to break methods down the chain.
    // This needs investigating further, but strongly suspect it's
    // related to the temporary way we retrieve annotationPages.
    // This has been patched in manifesto and can be updated.
    this.canvasAnnotations = pagesPerCanvas.map((pages) =>
      pages.flatMap((page) => page.getItems() || []),
    );
  }

  /**
   * Build an AnnotationPage from a raw v3 annotationPage or v2 annotation list\
   * Fetches it first if it's only a reference
   */
  async #createAnnotationPage(rawPage: unknown): Promise<AnnotationPage> {
    const url = getPageUrl(rawPage);
    const embedded = getAnnotationsFromPage(rawPage);
    let rawAnnotations: RawAnnotation[];

    if (embedded) {
      // Embedded annotations are used as they are
      rawAnnotations = embedded;
    } else if (url) {
      // Otherwise the page is only a reference
      rawAnnotations = await this.#fetchAnnotations(url);
    } else {
      this.#logger("ext-anno-err");
      rawAnnotations = [];
    }

    return new AnnotationPage(
      {
        id: url ?? "",
        type: "AnnotationPage",
        items: rawAnnotations.map(
          (rawAnnotation) =>
            new Annotation(rawAnnotation, this.manifest.options),
        ),
      },
      this.manifest.options,
    );
  }

  /**
   * Get the region from the URL as an OSD Rectangle\
   * This return value is agnostic to any particular OSD coordinate system
   * @returns OpenSeadragon.Rect using URL values or null if no matching fragment found
   */
  #getRegion(url?: string): OpenSeadragon.Rect | null {
    const xywh = url?.split("#xywh=")[1];

    if (xywh) {
      const [x, y, w, h] = xywh.split(",").map(Number);
      return new OpenSeadragon.Rect(x, y, w, h);
    }

    return null;
  }
}
