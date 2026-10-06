import {
  assertWithinAcceptableRange,
  getActualCentre,
  getExpectedCentre,
  ScreenSize,
  screenSizes,
} from "../support/utils";

const V2_MANIFEST =
  "http://localhost:43110/manifests/standard-v2/manifest.json";
const EMBEDDED_V2_MANIFEST =
  "http://localhost:43110/manifests/embedded-v2/manifest.json";

function setupViewer(screenSize: ScreenSize, manifestUrl: string) {
  cy.visit("/").then((window) => {
    cy.document().then((document) => {
      cy.viewport(screenSize.width, screenSize.height);
      const container = document.querySelector("#viewer");
      if (!window.StoriiiesViewer) return;

      window.storiiiesViewerInstance = new window.StoriiiesViewer({
        container,
        manifestUrl,
      });
    });
  });
}

function next(times: number = 1) {
  for (let i = 0; i < times; i++) {
    cy.get("#storiiies-viewer-0__next").click();
  }
}

/** Wait for the viewer to finish loading, then assert the width of the displayed image */
function assertImageWidth(width: number) {
  cy.get('#viewer[data-loaded="true"]');
  cy.window().should((window) => {
    const item = window.storiiiesViewerInstance.viewer.world.getItemAt(0);
    expect(item.getContentSize().x).to.equal(width);
  });
}

function assertCentre(region: string) {
  cy.window().should((window) => {
    const { viewer } = window.storiiiesViewerInstance;
    const expected = getExpectedCentre(region);
    const actual = getActualCentre(viewer);
    assertWithinAcceptableRange(expected.x, actual.x);
    assertWithinAcceptableRange(expected.y, actual.y);
  });
}

function externalAnnotationList(screenSize: ScreenSize) {
  describe(`v2 manifest with an external annotation list (${screenSize.label})`, () => {
    beforeEach(() => setupViewer(screenSize, V2_MANIFEST));

    it("Should not warn about the manifest version", () => {
      cy.get('#viewer[data-loaded="true"]').should(($el) => {
        expect($el.attr("data-status") ?? "").not.to.match(/unkn-version/);
      });
    });

    it("Should show the label, description and attribution on the title slide", () => {
      cy.get("#storiiies-viewer-0__info-text h1").should(
        "have.text",
        "Test v2 manifest",
      );
      cy.get("#storiiies-viewer-0__info-text").contains("A sample description");
      cy.get("#storiiies-viewer-0__info-text").contains("All rights reserved.");
    });

    it("Should show the annotations from the external list", () => {
      // Title, 3 annotations, credits
      next();
      cy.get("#storiiies-viewer-0__info-text").should(
        "have.html",
        `<div class="storiiies-viewer__text-section">Annotation 1</div>`,
      );
      next();
      cy.get("#storiiies-viewer-0__info-text").should(
        "have.html",
        `<div class="storiiies-viewer__text-section">Annotation 2</div>`,
      );
      next();
      cy.get("#storiiies-viewer-0__info-text").should(
        "have.html",
        `<div class="storiiies-viewer__text-section">Annotation 3</div>`,
      );
      next();
      cy.get("#storiiies-viewer-0__info-text").contains(
        "Storiiies was created by",
      );
      cy.get("#storiiies-viewer-0__next").should(
        "have.attr",
        "aria-label",
        "Restart",
      );
    });

    it("Should fit the viewer to the region the annotation is on", () => {
      assertImageWidth(4031);
      // Second annotation: 100,200,100,200
      next(2);
      cy.get("#storiiies-viewer-0__info-text").contains("Annotation 2");
      assertCentre("100,200,100,200");
    });
  });
}

function embeddedAnnotationLists(screenSize: ScreenSize) {
  describe(`v2 manifest with embedded lists and multiple canvases (${screenSize.label})`, () => {
    beforeEach(() => setupViewer(screenSize, EMBEDDED_V2_MANIFEST));

    // Slides:
    // 0 title
    // 1 canvas 1, annotation (SpecificResource target, text/plain)
    // 2 canvas 1, annotation (string target, text/html)
    // 3 canvas 2, intro
    // 4-6 canvas 2, annotations from an external list
    // 7 credits
    it("Should show a string label, description and attribution on the title slide", () => {
      cy.get("#storiiies-viewer-0__info-text h1").should(
        "have.text",
        "Embedded v2 manifest",
      );
      cy.get("#storiiies-viewer-0__info-text").contains(
        "An embedded v2 description",
      );
      cy.get("#storiiies-viewer-0__info-text").contains(
        "Courtesy of Example Institution",
      );
      assertImageWidth(2048);
    });

    it("Should convert plain text bodies and fit to a SpecificResource target", () => {
      next();
      cy.get("#storiiies-viewer-0__info-text").should(
        "have.html",
        `<div class="storiiies-viewer__text-section">Embedded v2 annotation<br><br>with a line break</div>`,
      );
      assertCentre("265,661,100,200");
    });

    it("Should sanitise HTML bodies and fit to a string target", () => {
      next(2);
      cy.get("#storiiies-viewer-0__info-text").should(
        "have.html",
        `<div class="storiiies-viewer__text-section"><p><strong>Bold</strong> html text</p></div>`,
      );
      assertCentre("500,500,200,200");
    });

    it("Should move on to the second canvas and its external list", () => {
      next(3);
      assertImageWidth(4031);
      cy.get("#storiiies-viewer-0__info-text h2").should(
        "have.text",
        "Second v2 canvas",
      );
      next();
      cy.get("#storiiies-viewer-0__info-text").contains("Annotation 1");
      next(3);
      cy.get("#storiiies-viewer-0__info-text").contains(
        "Storiiies was created by",
      );
    });
  });
}

for (const screenSize of screenSizes) {
  externalAnnotationList(screenSize);
  embeddedAnnotationLists(screenSize);
}
