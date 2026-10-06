import { ScreenSize, screenSizes } from "../support/utils";

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

function externalAnnotationPages(screenSize: ScreenSize) {
  describe(`External annotationPages (${screenSize.label})`, () => {
    beforeEach(() =>
      setupViewer(
        screenSize,
        "http://localhost:43110/manifests/external-annotation-pages-v3/manifest.json",
      ),
    );

    it("Should fetch and show annotations from an externally referenced annotationPage", () => {
      // Title, 2 annotations, credits
      cy.get("#storiiies-viewer-0__next").click();
      cy.get("#storiiies-viewer-0__info-text").should(
        "have.html",
        `<div class="storiiies-viewer__text-section">Nullam sit amet egestas metus. Sed dictum mattis erat feugiat gravida</div>`,
      );
      cy.get("#storiiies-viewer-0__next").click();
      cy.get("#storiiies-viewer-0__info-text").contains(
        "Suspendisse lacinia enim lorem",
      );
      cy.get("#storiiies-viewer-0__next").click();
      cy.get("#storiiies-viewer-0__info-text").contains(
        "Storiiies was created by",
      );
      cy.get("#storiiies-viewer-0__next").should(
        "have.attr",
        "aria-label",
        "Restart",
      );
    });

    it("Should not warn when the annotationPage loads", () => {
      cy.get('#viewer[data-loaded="true"]').should(($el) => {
        expect($el.attr("data-status") ?? "").not.to.match(/ext-anno-err/);
      });
    });
  });
}

for (const screenSize of screenSizes) {
  externalAnnotationPages(screenSize);
}
