import { ScreenSize, screenSizes } from "../support/utils";

const MULTIPLE_IMAGES_MANIFEST =
  "http://localhost:43110/manifests/multiple-images-v3/manifest.json";

const THUMBNAILS = "#storiiies-viewer-0__thumbnails";
const THUMBNAIL = `${THUMBNAILS} .storiiies-viewer__thumbnail`;

function setupViewer(
  screenSize: ScreenSize,
  manifestUrl: string = MULTIPLE_IMAGES_MANIFEST,
  showThumbnails?: boolean,
) {
  cy.visit("/").then((window) => {
    cy.document().then((document) => {
      cy.viewport(screenSize.width, screenSize.height);
      const container = document.querySelector("#viewer");
      if (!window.StoriiiesViewer) return;

      window.storiiiesViewerInstance = new window.StoriiiesViewer({
        container,
        manifestUrl,
        showThumbnails,
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

function thumbnail(canvasIndex: number) {
  return cy.get(`${THUMBNAIL}[data-canvas-index="${canvasIndex}"]`);
}

// Slides (with credits) in multiple-images-v3:
// 0 title, 1-2 image 1, 3 image 2 intro, 4 image 2, 5 image 3 intro, 6 credits
function thumbnails(screenSize: ScreenSize) {
  describe(`Image previews (${screenSize.label})`, () => {
    beforeEach(() => setupViewer(screenSize));

    it("Should show a labelled preview for each image", () => {
      cy.get(THUMBNAILS)
        .should("have.prop", "tagName", "NAV")
        .and("have.attr", "aria-label", "Images");
      cy.get(THUMBNAIL).should("have.length", 3);

      thumbnail(0).should("have.attr", "aria-label", "Image 1 of 3");
      thumbnail(1).should(
        "have.attr",
        "aria-label",
        "Image 2 of 3: Second image",
      );
      thumbnail(2).should("have.attr", "aria-label", "Image 3 of 3");
    });

    it("Should load a preview image from each image's service, at a size it actually offers", () => {
      // Level 0 image services only serve the sizes listed in their info.json
      thumbnail(0)
        .find("img")
        .should("have.attr", "src")
        .and(
          "eq",
          "http://localhost:43110/images/exact-tiles/full/256,/0/default.jpg",
        );
      thumbnail(1)
        .find("img")
        .should("have.attr", "src")
        .and(
          "eq",
          "http://localhost:43110/images/tractor/full/252,/0/default.jpg",
        );

      // ...and they really did load
      cy.get(`${THUMBNAIL} img`).each(($img) => {
        cy.wrap($img).should(($el) => {
          expect(($el[0] as HTMLImageElement).naturalWidth).to.be.greaterThan(
            0,
          );
        });
      });
    });

    it("Should sit on the right hand side of the viewer", () => {
      cy.get("#viewer").then(($viewer) => {
        const viewerRect = $viewer[0].getBoundingClientRect();
        cy.get(THUMBNAILS).should(($thumbnails) => {
          const rect = $thumbnails[0].getBoundingClientRect();
          expect(rect.left + rect.width / 2).to.be.greaterThan(
            viewerRect.left + viewerRect.width / 2,
          );
          expect(rect.right).to.be.at.most(viewerRect.right);
        });
      });
    });

    it("Should mark the preview of the image being viewed", () => {
      thumbnail(0).should("have.attr", "aria-current", "true");
      thumbnail(1).should("not.have.attr", "aria-current");
      thumbnail(2).should("not.have.attr", "aria-current");

      // Clicking through annotations onto the second image
      for (let i = 0; i < 3; i++) {
        cy.get("#storiiies-viewer-0__next").click();
      }
      thumbnail(1).should("have.attr", "aria-current", "true");
      cy.get(`${THUMBNAIL}[aria-current="true"]`).should("have.length", 1);
    });

    it("Should jump straight to an image, without clicking through annotations", () => {
      thumbnail(1).click();

      assertImageWidth(4031);
      cy.get("#viewer").should("have.attr", "data-active-canvas", "1");
      cy.get("#storiiies-viewer-0__info-text h2").should(
        "have.text",
        "Second image",
      );
      thumbnail(1).should("have.attr", "aria-current", "true");
      cy.get(`${THUMBNAIL}[aria-current="true"]`).should("have.length", 1);

      // Navigation carries on from there
      cy.get("#storiiies-viewer-0__previous").should("not.be.disabled");
      cy.get("#storiiies-viewer-0__next").click();
      cy.get("#storiiies-viewer-0__info-text").contains(
        "Second image, region annotation",
      );
    });

    it("Should jump to an image with no annotations or label", () => {
      thumbnail(2).click();

      assertImageWidth(2048);
      cy.get("#viewer").should("have.attr", "data-active-canvas", "2");
      cy.get("#storiiies-viewer-0__info-text h2").should(
        "have.text",
        "Image 3",
      );
    });

    it("Should jump back to the start of the story from the first image's preview", () => {
      thumbnail(1).click();
      assertImageWidth(4031);

      thumbnail(0).click();
      assertImageWidth(2048);
      cy.get("#storiiies-viewer-0__info-text h1").should(
        "have.text",
        "A story with multiple images",
      );
      cy.get("#storiiies-viewer-0__previous").should("be.disabled");
      thumbnail(0).should("have.attr", "aria-current", "true");
    });

    it("Should be usable with the keyboard", () => {
      thumbnail(1).focus().type("{enter}");

      assertImageWidth(4031);
      cy.get("#viewer").should("have.attr", "data-active-canvas", "1");
    });

    it("Should still show points of interest for the image jumped to", () => {
      thumbnail(1).click();
      assertImageWidth(4031);
      cy.get(
        "#storiiies-viewer-0__osd-container button.storiiies-viewer__poi-marker",
      ).should("not.exist");

      thumbnail(0).click();
      assertImageWidth(2048);
      cy.get(
        "#storiiies-viewer-0__osd-container button.storiiies-viewer__poi-marker[data-poi-index='1']",
      ).should("exist");
    });
  });

  describe(`Image previews, where they shouldn't appear (${screenSize.label})`, () => {
    it("Should not show previews when there's only one image", () => {
      setupViewer(
        screenSize,
        "http://localhost:43110/manifests/standard-v3/manifest.json",
      );
      cy.get('#viewer[data-loaded="true"]');
      cy.get(THUMBNAILS).should("not.exist");
    });

    it("Should not show previews when turned off", () => {
      setupViewer(screenSize, MULTIPLE_IMAGES_MANIFEST, false);
      cy.get('#viewer[data-loaded="true"]');
      cy.get(THUMBNAILS).should("not.exist");
    });
  });

  describe(`Image previews provided by the manifest (${screenSize.label})`, () => {
    it("Should use a canvas's own thumbnail in preference to its image service", () => {
      cy.fixture("/manifests/multiple-images-v3/manifest.json").then(
        (manifest) => {
          manifest.items[1].thumbnail = [
            {
              id: "http://localhost:43110/images/embedded/duck.jpg",
              type: "Image",
              format: "image/jpeg",
            },
          ];
          cy.intercept("GET", "/manifests/multiple-images-v3/manifest.json", {
            body: manifest,
          });
        },
      );
      setupViewer(screenSize);

      thumbnail(1)
        .find("img")
        .should("have.attr", "src")
        .and("eq", "http://localhost:43110/images/embedded/duck.jpg");
      // The others still come from their image services
      thumbnail(0)
        .find("img")
        .should("have.attr", "src")
        .and("match", /\/images\/exact-tiles\/full\/256,\/0\/default\.jpg$/);
    });

    it("Should fall back to the target width, and still work, if an image service can't be asked for its sizes", () => {
      // Only the first request fails. That's the preview looking up the sizes on offer,
      // as the second image isn't opened by the viewer until it's jumped to
      cy.intercept(
        { method: "GET", url: "/images/tractor/info.json", times: 1 },
        { statusCode: 500 },
      );
      setupViewer(screenSize);

      thumbnail(1)
        .find("img")
        .should("have.attr", "src")
        .and(
          "eq",
          "http://localhost:43110/images/tractor/full/160,/0/default.jpg",
        );

      // The preview is still a working button
      thumbnail(1).click();
      assertImageWidth(4031);
    });
  });
}

for (const screenSize of screenSizes) {
  thumbnails(screenSize);
}
