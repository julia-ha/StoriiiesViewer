# Storiiies Viewer ![Build status badge](https://github.com/CogappLabs/StoriiiesViewer/actions/workflows/build.yml/badge.svg)

![Storiies promotional banner](docs/Storiies_banner_1280_95.jpg)

Storiiies Viewer is an open source viewer for [Storiiies](https://www.cogapp.com/r-d/storiiies), the IIIF digital storytelling platform.

## Demo

[See an example StoriiiesViewer in action on codepen](https://codepen.io/Cogapp/pen/JjxbjGz)

## Usage

[API documentation](https://cogapplabs.github.io/StoriiiesViewer/api)

### Adding the dependencies

There are two options for adding StoriiiesViewer to your project:

#### In the browser

(This is the quickest and easiest way to get started)

You can include the JavaScript and CSS in the HTML like so, using the [unpkg CDN](https://unpkg.com/):

```HTML
<head>
  <!-- ... -->
  <link rel="stylesheet" href="https://unpkg.com/@cogapp/storiiies-viewer@latest/dist/storiiies-viewer.css">
  <script src="https://unpkg.com/@cogapp/storiiies-viewer@latest/dist/umd/storiiies-viewer.js"></script>
  <!-- ... -->
</head>
```

Or you could save these files and serve them locally if you prefer.

Including the JavaScript file this way will make `StoriiiesViewer` available globally in JavaScript.

#### Using a bundler

1. Install the dependecy with `npm install @cogapp/storiiies-viewer`
2. Use `import StoriiiesViewer from '@cogapp/storiiies-viewer'` in your code to access the StoriiiesViewer constructor
3. Depending on how your tooling handles importing CSS you might also be able to import the CSS file with `import @cogapp/storiiies-viewer/dist/storiiies-viewer.css` — but you could also use the method above, or copy the contents of the CSS file into your own src files.

### Initialise a viewer

In your HTML:

```HTML
<div id="storiiies-viewer"></div>
```

In your JavaScript

```JS
document.addEventListener('DOMContentLoaded', () => {
  const myViewer = new StoriiiesViewer({
    container: "#storiiies-viewer", // or document.querySelector("#storiiies-viewer")
    manifestUrl: "https://path-to-your-storiiies-manifest",
  });
});
```

## Customisation

To customise of appearance of StoriiiesViewer you have a few options:

1. If you'd prefer to bring all your own styles, StoriiiesViewer can be styled from scratch without needing to include the default stylesheet
2. To 'theme' StoriiiesViewer, you may find the custom properties provided by the default stylesheet to be sufficient
3. Start with default stylesheet and expand or override these styles as you see fit

### Disabling Mouse Navigation

If you want to disable interactions such as panning and zooming via scroll, you can pass the `disablePanAndZoom` option when initializing the viewer:

```js
document.addEventListener("DOMContentLoaded", () => {
  const myViewer = new StoriiiesViewer({
    container: "#storiiies-viewer",
    manifestUrl: "https://path-to-your-storiiies-manifest",
    disablePanAndZoom: true, // Disables mouse navigation
  });
});
```

### Image previews

When a manifest has more than one image, a column of small previews appears on the right hand side of the viewer. Clicking one jumps straight to the start of that image's part of the story, without clicking through the annotations in between. The preview of the image currently being viewed is highlighted. They're also keyboard accessible, as a labelled group of buttons.

Each preview uses the canvas's own `thumbnail` if it has one (v3 `thumbnail`, or v2 `thumbnail`). Otherwise it's requested from the canvas's IIIF image service, at the smallest size the service says it offers (from its `info.json`) that's at least 160px wide, so image services that only support a fixed set of sizes work too.

Previews are never shown for a manifest with one image. To turn them off for manifests with several, pass the `showThumbnails` option:

```js
const myViewer = new StoriiiesViewer({
  container: "#storiiies-viewer",
  manifestUrl: "https://path-to-your-storiiies-manifest",
  showThumbnails: false, // Defaults to true
});
```

The size of the previews and the space between them can be changed with the `--storiiies-viewer-thumbnail-size` and `--storiiies-viewer-thumbnail-gap` custom properties. On narrow viewers the previews are shown at 75% of this size.

### Using a custom "point of interest" SVG

You may provide a custom SVG graphic to use with points of interest.

```js
document.addEventListener("DOMContentLoaded", () => {
  const myViewer = new StoriiiesViewer({
    container: "#storiiies-viewer",
    manifestUrl: "https://path-to-your-storiiies-manifest",
    pointOfInterestSvgUrl: 'https://path-to-your-svg'
  });
});
```

This overrides the default graphic from StoriiiesViewer. This SVG will be sanitized before it's inserted, and we have a permissive but possibly not exhaustive list of tags and attributes which are allowed.

The default colour and highlighting on activation and hover of points of interest are controlled by a CSS custom property applied to the `color` rule. If you'd like your custom graphic to use this colourisation then you can use `currentColor` on the parts of the graphic that should adopt this.

## Supported manifest formats

StoriiiesViewer supports a subset of the [IIIF presentation API v3](https://iiif.io/api/presentation/3.0/). Specifically, we target `annotationPages` which are included directly in the manifest ([like in this cookbook recipe](https://iiif.io/api/cookbook/recipe/0258-tagging-external-resource/)), or which are referenced from the manifest and fetched ([as shown in this cookbook recipe](https://iiif.io/api/cookbook/recipe/0306-linking-annotations-to-manifests/)).

[Presentation API v2](https://iiif.io/api/presentation/2.1/) manifests are also supported, by converting them to the v3 shape as they're read. See [Presentation API v2 manifests](#presentation-api-v2-manifests) below.

Text based annotations can either be `text/plain` or `text/html` denoted by the `format` field. For `text/plain` newline characters will be converted and output as `<br>` tags.

Support for audio exists, and StoriiiesViewer will render an `<audio />` element for annotations that have a type of `Sound`, and which are structured [like shown in this cookbook recipe](https://iiif.io/api/cookbook/recipe/0002-mvm-audio/).

Multiple images are supported. Each `Canvas` in the manifest's `items` is shown as its own image, with its own `annotations`, in the order they appear. The story runs through the title slide, then each image's annotations in turn, and finally the credit slide. When moving between images the viewer loads the next image and returns to a view of the whole of it. Previews of the images are shown so that it's easy to jump between them (see [Image previews](#image-previews)). Images after the first get an intro slide showing the whole image if the canvas has a `label` (which is shown as a heading), or if it has no annotations (so it would otherwise be skipped; a fallback heading of "Image *n*" is used if there's no label). Canvases without an IIIF image service can't be displayed, so are skipped with a console warning.

Points of interest (markers that target a single point, rather than a region), can be rendered by using a `target` with a type of `specificResource` and a `selector` of `type: "pointSelector"`. See this [cookbook recipe for an example](https://iiif.io/api/cookbook/recipe/0135-annotating-point-in-canvas/).

StoriiiesViewer has no required fields (aside from those required by the presentation API), but it will render certain values from the manifest if provided. These are:

- [A manifest `label`](https://iiif.io/api/presentation/3.0/#label), which is required by the presentation API and will be shown on a "title slide", before any annotations
- [A manifest level `summary`](https://iiif.io/api/presentation/3.0/#summary), which will appear below the label if provided
- [A manifest level `requiredStatement`](https://iiif.io/api/presentation/3.0/#requiredstatement), which will appear below the summary if provided

> [!NOTE]<br>
> Certain features which aren't currently supported include:
>
> - Full multi-lingual support
>
> However, pathways exist to enable this feature with further development.

> [!WARNING]<br>
> Manifests that aren't Presentation API v2 or v3 may load images, but aren't guaranteed to work beyond this, and will display a warning in the console.

### External annotation pages

An `annotationPage` that only has an `id` (no `items`) is fetched, and its annotations are shown in place. Relative URLs are resolved against the manifest's URL. The server must allow cross-origin requests if it's on a different origin to your page. If a page can't be fetched, or isn't an annotation page, a warning is logged, the container's `data-status` attribute includes `ext-anno-err`, and the page is skipped.

### Presentation API v2 manifests

Presentation API v2 manifests are converted as they're read, so these are all handled:

- Images via the canvas's image service
- A manifest `label`, `description` (used as the summary), and `attribution` (used as the required statement), and canvas `label`s
- Annotation lists in a canvas's `otherContent`, either embedded (with `resources`) or referenced by URL and fetched
- Text annotations (`cnt:ContentAsText`, using `chars` and `format`) and audio annotations
- Annotation targets (`on`) given as a canvas URI with an optional `#xywh=` fragment, or an `oa:SpecificResource` with an `oa:FragmentSelector`

What v2 can't express, or isn't converted:

- Points of interest, as v2 has no standard equivalent. Use a region target instead
- Other kinds of selector (e.g. `oa:SvgSelector`). The annotation is treated as targeting the whole canvas
- Annotation bodies that aren't text or audio. These are ignored

### Compatibility with Storiiies Editor

Cogapp maintains a free-to-use editor for Storiiies at [storiiies-editor.cogapp.com](https://storiiies-editor.cogapp.com/). To use a compatible v3 manifest for your story, append the short alphanumeric code from the "view and share" link to a base URL of `https://manifest.storiiies-editor.cogapp.com/v3/`

For example, for the link <https://storiiies.cogapp.com/viewer/7e4va/A-Sunday-on-La-Grande-Jatte-1884> use a manifest URL of <https://manifest.storiiies-editor.cogapp.com/v3/7e4va>

## Local development

### Installation

#### Pre-requisites

- [Node.js / npm](https://docs.npmjs.com/downloading-and-installing-node-js-and-npm)

> [!IMPORTANT]<br>
> Although optional, we recommend using [nvm](https://github.com/nvm-sh/nvm) to match the version of Node used in this project before running the install command, or the npm scripts described below.
>
> If you encounter problems and aren't using the version of Node shown in the [.nvmrc](.nvmrc) file, you should try aligning your node version to this first. This represents a known compatibility with the code here and our dependencies.

#### Setup

Switch node version and install the dependencies in the project root with:

```console
nvm use
npm ci
```

### Compiling and previewing changes

<table width="100%">
  <thead>
    <tr>
      <th width="300px">Command</th>
      <th width="800px">Action</th>
    </tr>
  </thead>
  <tbody>
    <tr>
      <td><code>npm run dev</code></td>
      <td>Watches files in the <a href="./src"><code>src</code></a> directory for changes and serves a preview at <a href="https://localhost:43110">https://localhost:43110</a> with hot module replacement</td>
    </tr>
    <tr>
      <td><code>npm run build</code></td>
      <td>Builds the package for use in production. See "<a href="#usage">Usage</a>" for how this package can be used</td>
    </tr>
  </tbody>
</table>

### Running the tests

<table width="100%">
  <thead>
    <tr>
      <th width="300px">Command</th>
      <th width="800px">Action</th>
    </tr>
  </thead>
  <tbody>
    <tr>
      <td><code>npm run test:gui</code></td>
      <td>Will start the local dev server and run the e2e tests with the interactive GUI</td>
    </tr>
    <tr>
      <td><code>npm run test</code></td>
      <td> Starts the dev server as above, but instead runs the tests without the GUI</td>
    </tr>
  </tbody>
</table>

> [!NOTE]<br> `npm run cypress:gui` and `npm run cypress` will also do the same as the above _without_ starting the dev server, if you already have it running.

### Linting the code

<table width="100%">
  <thead>
    <tr>
      <th width="300px">Command</th>
      <th width="800px">Action</th>
    </tr>
  </thead>
  <tbody>
    <tr>
      <td><code>npm run lint</code></td>
      <td>Will lint (and fix where possible) all problems in the code</td>
    </tr>
  </tbody>
</table>

### Image credits from banner image

Georges Seurat. _[A Sunday on La Grande Jatte](https://www.artic.edu/artworks/27992/a-sunday-on-la-grande-jatte-1884)_, 1884-86. The Art Institute of Chicago.<br>
Vincent van Gogh. _[The Bedroom](https://www.artic.edu/artworks/28560/the-bedroom)_, 1889. The Art Institute of Chicago.<br>
Rosalba Carriera. _[A Young Lady with a Parrot](https://www.artic.edu/artworks/103887/a-young-lady-with-a-parrot)_, c. 1730. The Art Institute of Chicago.
