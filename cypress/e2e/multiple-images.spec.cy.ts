import {
  assertWithinAcceptableRange,
  getActualCentre,
  getExpectedCentre,
  ScreenSize,
  screenSizes,
} from "../support/utils";

const MANIFEST_URL =
  "http://localhost:43110/manifests/multiple-images-v3/manifest.json";

function setupViewer(screenSize: ScreenSize, showCreditSlide: boolean = true) {
  cy.visit("/").then((window) => {
    cy.document().then((document) => {
      cy.viewport(screenSize.width, screenSize.height);
      const container = document.querySelector("#viewer");
      if (!window.StoriiiesViewer) return;

      window.storiiiesViewerInstance = new window.StoriiiesViewer({
        container,
        manifestUrl: MANIFEST_URL,
        showCreditSlide,
      });
    });
  });
}

/** Wait for the viewer to finish loading, then assert the width of the displayed image */
function assertImageWidth(width: number) {
  cy.get('#viewer[data-loaded="true"]');
  cy.window().should((window) => {
    const item = window.storiiiesViewerInstance.viewer.world.getItemAt(0);
    expect(item.getContentSize().x).to.equal(width);
  });
}

function next(times: number = 1) {
  for (let i = 0; i < times; i++) {
    cy.get("#storiiies-viewer-0__next").click();
  }
}

function previous(times: number = 1) {
  for (let i = 0; i < times; i++) {
    cy.get("#storiiies-viewer-0__previous").click();
  }
}

// Slides (with credits):
// 0 title
// 1 image 1, region annotation
// 2 image 1, point of interest
// 3 image 2, intro (has a label)
// 4 image 2, region annotation
// 5 image 3, intro (no label, no annotations)
// 6 credits
function multipleImages(screenSize: ScreenSize) {
  describe(`Multiple images (${screenSize.label})`, () => {
    beforeEach(() => setupViewer(screenSize));

    it("Should start on the first image", () => {
      assertImageWidth(2048);
      cy.get("#viewer").should("have.attr", "data-loaded", "true");
    });

    it("Should move on to the next image after the last annotation of the current one", () => {
      assertImageWidth(2048);
      next(2);
      cy.get("#storiiies-viewer-0__info-text").contains(
        "First image, point of interest",
      );
      assertImageWidth(2048);

      next();
      assertImageWidth(4031);
      cy.get("#viewer").should("have.attr", "data-active-canvas", "1");
    });

    it("Should introduce a labelled image with its label", () => {
      next(3);
      cy.get("#storiiies-viewer-0__info-text h2").should(
        "have.text",
        "Second image",
      );
    });

    it("Should introduce an image with no label or annotations using a fallback", () => {
      next(5);
      cy.get("#storiiies-viewer-0__info-text h2").should(
        "have.text",
        "Image 3",
      );
      assertImageWidth(2048);
      cy.get("#viewer").should("have.attr", "data-active-canvas", "2");
    });

    it("Should show the whole of an image when introducing it", () => {
      next(3);
      assertImageWidth(4031);
      cy.window().should((window) => {
        const { viewer } = window.storiiiesViewerInstance;
        const expected = getExpectedCentre("0,0,4031,3023");
        const actual = getActualCentre(viewer);
        assertWithinAcceptableRange(expected.x, actual.x);
        assertWithinAcceptableRange(expected.y, actual.y);
      });
    });

    it("Should fit annotations to the region of the current image", () => {
      next(4);
      assertImageWidth(4031);
      cy.get("#storiiies-viewer-0__info-text").contains(
        "Second image, region annotation",
      );
      cy.window().should((window) => {
        const { viewer } = window.storiiiesViewerInstance;
        const expected = getExpectedCentre("1000,800,800,600");
        const actual = getActualCentre(viewer);
        assertWithinAcceptableRange(expected.x, actual.x);
        assertWithinAcceptableRange(expected.y, actual.y);
      });
    });

    it("Should only show points of interest for the current image", () => {
      const poiMarkers =
        "#storiiies-viewer-0__osd-container button.storiiies-viewer__poi-marker";

      // Image 1 has a POI as its second annotation
      cy.get(`${poiMarkers}[data-poi-index='1']`).should("exist");

      next(3);
      assertImageWidth(4031);
      cy.get(poiMarkers).should("not.exist");

      // And it comes back when returning to the first image
      previous(2);
      assertImageWidth(2048);
      cy.get(`${poiMarkers}[data-poi-index='1']`).should("exist");
    });

    it("Should be able to go back to a previous image", () => {
      next(3);
      assertImageWidth(4031);
      previous();
      assertImageWidth(2048);
      cy.get("#storiiies-viewer-0__info-text").contains(
        "First image, point of interest",
      );
    });

    it("Should display the credits after the last image, and restart on the first", () => {
      next(6);
      cy.get("#storiiies-viewer-0__next").should(
        "have.attr",
        "aria-label",
        "Restart",
      );
      cy.get("#storiiies-viewer-0__info-text").contains(
        "Storiiies was created by",
      );

      cy.get("#storiiies-viewer-0__next").click();
      assertImageWidth(2048);
      cy.get("#storiiies-viewer-0__previous").should("be.disabled");
      cy.get("#storiiies-viewer-0__info-text h1").should(
        "have.text",
        "A story with multiple images",
      );
      cy.get("#viewer").should("have.attr", "data-active-canvas", "0");
    });
  });

  describe(`Multiple images without credit slide (${screenSize.label})`, () => {
    beforeEach(() => setupViewer(screenSize, false));

    it("Should restart from the last image's final slide", () => {
      // Slides: 0-5 (no credits)
      next(5);
      cy.get("#storiiies-viewer-0__next").should(
        "have.attr",
        "aria-label",
        "Restart",
      );
      cy.get("#storiiies-viewer-0__next").click();
      assertImageWidth(2048);
      cy.get("#storiiies-viewer-0__previous").should("be.disabled");
    });
  });
}

for (const screenSize of screenSizes) {
  multipleImages(screenSize);
}
