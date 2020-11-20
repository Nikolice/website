const fs = require("fs");
const nodePath = require("path");
const redent = require("redent");
const highlight = require("../../utils/highlight");
const prettyprint = require("@marko/prettyprint");
const { importDefault } = require("@marko/babel-utils");
const { getMarkoWebsiteKey } = require("../../utils/localstorage");
const ADDED_SYNTAX_SWITCH_SCRIPT = new WeakSet();

module.exports = function (path, t) {
  const attrs = attrsByName(path);
  let code;
  let lang;

  if (attrs.file) {
    const fileNodePath = attrs.file;

    if (!fileNodePath.isStringLiteral()) {
      throw fileNodePath.buildCodeFrameError(
        "<code-block> file attribute must be a string."
      );
    }

    const unresolvedPath = fileNodePath.node.value;
    const filePath = nodePath.resolve(
      path.hub.file.opts.sourceFileName,
      "..",
      unresolvedPath
    );

    if (!fs.existsSync(filePath)) {
      throw path.buildCodeFrameError(
        `<code-block> could not resolve "${unresolvedPath}".`
      );
    }

    lang = nodePath.extname(filePath).slice(1);
    code = fs.readFileSync(filePath, "utf-8");
  } else {
    const textNodePath = path.get("body.body.0");
    const langNodePath = attrs.lang;

    if (!textNodePath || !textNodePath.isMarkoText()) {
      throw (textNodePath || path).buildCodeFrameError(
        "<code-block> missing body content."
      );
    }

    if (!langNodePath || !langNodePath.isStringLiteral()) {
      throw (langNodePath || path).buildCodeFrameError(
        "<code-block> with body content requires a lang attribute that is a string."
      );
    }

    lang = langNodePath.node.value;
    code = textNodePath.node.value;
  }

  const linesNodePath = attrs.lines;
  let lines;

  if (linesNodePath) {
    if (!linesNodePath.isStringLiteral()) {
      throw linesNodePath.buildCodeFrameError(
        "<code-block> 'lines' attribute must be a string."
      );
    }

    lines = linesNodePath.node.value;
  }

  code = redent(
    code.replace(/&lt;/g, "<").replace(/&#36;/g, "$").replace(/&amp;/g, "&")
  ).trim();

  let html = highlight(lang, code);

  if (lines) {
    let currentLine = 0;
    let currentIndex = 0;
    lines = parseLineRange(lines);
    html = html.replace(/.*\n/g, m => {
      if (++currentLine === lines[currentIndex]) {
        currentIndex++;
        return `<div class=line-highlight>${m.slice(0, -1)}</div>`;
      }
      return m;
    });
  }

  const prev = getPreviousNonWhitespaceNode(path);
  const innerNode = getSingleInnerEmNode(prev);

  if (innerNode && innerNode.isMarkoText()) {
    innerNode.set("value", innerNode.get("value").node.replace(/\:$/, ""));
    prev.replaceWith(
      t.markoTag(
        t.stringLiteral("div"),
        [t.markoAttribute("class", t.stringLiteral("code-block-filename"))],
        t.markoTagBody([innerNode.node])
      )
    );
  }

  if (!ADDED_SYNTAX_SWITCH_SCRIPT.has(path.hub)) {
    const key = getMarkoWebsiteKey("syntax");
    path.insertBefore(
      t.markoTag(
        t.stringLiteral("script"),
        [],
        t.markoTagBody([
          t.markoText(
            `if(localStorage.getItem('${key}') === 'concise'){document.body.classList.add('concise')}`
          )
        ])
      )
    );
    ADDED_SYNTAX_SWITCH_SCRIPT.add(path.hub);
  }

  if (lang === "marko" && !attrs["no-switch"]) {
    try {
      const next = path.getNextSibling();
      const nextIsCodeBlock =
        next.node && next.get("name").node === "code-block";
      const nextLang = nextIsCodeBlock && attrs.lang.node;
      const nextIsMarko = nextLang === "marko";
      let concise;

      if (nextIsMarko) {
        concise = highlight(lang, path.get("body.body.0.value").node);
        next.remove();
      } else {
        concise = highlight(lang, prettyprint(code, {
          filename: `${path.hub.file.opts.sourceFileName}.inline-code-block.marko`,
          syntax: "concise"
        }).trim());
      }

      path.replaceWith(
        t.markoTag(
          importDefault(
            path.hub.file,
            nodePath.join(__dirname, "../code-block-marko/index.marko"),
            "marko_code_block"
          ),
          [
            t.markoAttribute("html", t.stringLiteral(html)),
            t.markoAttribute("concise", t.stringLiteral(concise))
          ],
          t.markoTagBody([])
        )
      );
      return;
    } catch (e) {
      console.error(e);
    }
  }

  path.replaceWith(t.markoPlaceholder(t.stringLiteral(html), false));
};

function parseLineRange(string) {
  var ranges = string.split(",");
  var lines = [];

  ranges.forEach(range => {
    var limits = range.trim().split("-");
    var start = parseInt(limits[0].trim());
    var end = limits[1] ? parseInt(limits[1].trim()) : start;

    for (var i = start; i <= end; i++) {
      lines.push(i);
    }
  });

  return lines.sort((a, b) => a - b);
}

function attrsByName(path) {
  const result = {};
  for (const attr of path.get("attributes")) {
    const name = attr.get("name").node;
    if (name) {
      result[name] = attr.get("value");
    }
  }

  return result;
}

function getPreviousNonWhitespaceNode(path) {
  var prev = path.getPrevSibling();
  while (
    prev.isMarkoText() &&
    prev.get("value").isStringLiteral() &&
    /^\s*$/.test(prev.get("value.value").node)
  ) {
    prev = prev.getPrevSibling();
  }
  return prev;
}

function getSingleInnerEmNode(path) {
  if (is(path, "p")) {
    const child = onlyChild(path);
    if (is(child, "em")) {
      return onlyChild(child);
    }
  }

  function is(path, tagName) {
    return path.node && path.get("name").isStringLiteral({ value: tagName });
  }

  function onlyChild(path) {
    const body = path.get("body.body");
    return body.length === 1 && body[0];
  }
}
