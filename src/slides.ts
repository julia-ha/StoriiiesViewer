/**
 * A single step in the story. The viewer moves through a flat list of these:
 * an optional landing page or a title slide, then (for each image) an optional intro slide,
 * that image's annotations, and an overview slide, and finally an optional credit slide
 */
export type Slide =
  | { type: "landing"; canvasIndex: number }
  | { type: "title"; canvasIndex: number }
  | { type: "canvas"; canvasIndex: number }
  | { type: "annotation"; canvasIndex: number; annotationIndex: number }
  | { type: "overview"; canvasIndex: number }
  | { type: "credits"; canvasIndex: number };

export type SlideOptions = {
  /** Whether the story starts with a landing page. It introduces the story, so replaces the title slide */
  hasLanding?: boolean;
  /** Whether there's a title slide (the manifest has a label) */
  hasTitle: boolean;
  /** Whether there's a credit slide at the end */
  showCredits: boolean;
  /** What's needed to know about each canvas (image), in order */
  canvases: Array<{ annotationCount: number; hasLabel: boolean }>;
};

/**
 * Work out every slide in the story, in order
 */
export function buildSlides({
  hasLanding = false,
  hasTitle,
  showCredits,
  canvases,
}: SlideOptions): Slide[] {
  const slides: Slide[] = [];
  const hasMultipleImages = canvases.length > 1;

  if (hasLanding) {
    // The landing page already shows what the title slide would, so it's not repeated
    slides.push({ type: "landing", canvasIndex: 0 });
  } else if (hasTitle) {
    slides.push({ type: "title", canvasIndex: 0 });
  }

  canvases.forEach(({ annotationCount, hasLabel }, canvasIndex) => {
    // Images after the first get an intro slide showing the whole image,
    // if there's something to say (a label), or nothing else would show it (no annotations)
    if (canvasIndex > 0 && (!annotationCount || hasLabel)) {
      slides.push({ type: "canvas", canvasIndex });
    }

    for (
      let annotationIndex = 0;
      annotationIndex < annotationCount;
      annotationIndex++
    ) {
      slides.push({ type: "annotation", canvasIndex, annotationIndex });
    }

    // After the last annotation of an image, zoom back out to show the whole of it
    // rather than leaving the viewer zoomed in on that annotation as the story moves on.
    // This is only for stories with several images, so the flow for a single image is unchanged
    if (hasMultipleImages && annotationCount) {
      slides.push({ type: "overview", canvasIndex });
    }
  });

  if (showCredits) {
    slides.push({ type: "credits", canvasIndex: canvases.length - 1 });
  }

  return slides;
}
