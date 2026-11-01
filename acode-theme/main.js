(function () {
  "use strict";

  var PLUGIN_ID = "acode.plugin.repechul.godot.colors.editor.theme";
  var THEME_ID = "godot.colors.4.7";
  var THEME_CAPTION = "Godot Colors";
  var IS_DARK = true;

  /* ------------------------------------------------------------------
     Eight hue families, three rungs each (light / base / deep).
     Every token is assigned by ROLE inside its family, so related
     things share a hue and different things never share a rung.
     ------------------------------------------------------------------ */
  var palette = {
    // ---- Neutral ----
    background: "#0F0F0F",
    gutterBg: "#1A1A1A",
    panelBg: "#1A1A1A",
    printMargin: "#1A1A1A",
    activeLine: "#1A1A1A",
    scrollbarThumb: "#404040",
    panelBorder: "#404040",
    tooltipBorder: "#404040",
    indentGuide: "#404040",
    invisibles: "#404040",
    foreground: "#FFFFFF",
    lineNumber: "#BEBEBE",
    activeLineNumber: "#FFFFFF",
    panelFg: "#BEBEBE",
    tooltipFg: "#FFFFFF",
    tooltipBg: "#1A1A1A",
    foldPlaceholderBg: "#FFCC00",
    foldPlaceholderFg: "#0F0F0F",
    caret: "#FFFFFF",
    selectionBg: "rgba(120, 112, 222, 0.30)",
    selectionMatchBg: "rgba(120, 112, 222, 0.22)",
    matchingBracket: "#7870DE",
    nonMatchingBracket: "#FF0000",
    searchMatch: "#FFCC00",
    searchMatchSelected: "#FFCC00",

    // ---- GOLD · numbers, declared names, rare names ----
    goldLight: "#FFE066",
    gold: "#FFCC00",
    goldDeep: "#E0A800",

    // ---- ORANGE · variable uses, control keywords ----
    orangeLight: "#FF8B3D",
    orange: "#FF6600",

    // ---- BLUE · functions, structural keywords ----
    sky: "#82E2F6",
    blue: "#7870DE",

    // ---- PINK · keys, properties, private ----
    pinkLight: "#FFB8DC",
    pink: "#F98BC3",
    pinkDeep: "#E06AA0",

    // ---- GREEN · strings, escapes ----
    lime: "#66FF00",
    greenMuted: "#99CC99",

    // ---- TEAL · types, classes, builtins ----
    teal: "#339999",

    // ---- VIOLET · constants, comments ----
    violetLight: "#C77DFF",
    violet: "#9933CC",

    // ---- NEUTRAL tokens ----
    dim: "#BEBEBE",
    white: "#FFFFFF",
    invalid: "#CCFF33",
    deleted: "#FF0000",
  };

  var editorThemesApi = null;
  var cm6Registered = false;

  function buildCM6Theme() {
    editorThemesApi = editorThemesApi || acode.require("editorThemes");
    var cm = editorThemesApi.cm;
    var t = cm.tags;
    var p = palette;

    var rules = [
      // ---- VIOLET · comments ----
      { tag: t.comment, color: p.violet, fontStyle: "italic" },
      { tag: t.lineComment, color: p.violet, fontStyle: "italic" },
      { tag: t.blockComment, color: p.violet, fontStyle: "italic" },
      { tag: t.docComment, color: p.violetLight, fontStyle: "italic" },

      // ---- ORANGE · control keywords ----
      { tag: t.keyword, color: p.orange },
      { tag: t.controlKeyword, color: p.orange },
      { tag: t.operatorKeyword, color: p.orange },
      { tag: t.modifier, color: p.orangeLight },

      // ---- BLUE · structural keywords ----
      { tag: t.moduleKeyword, color: p.blue },
      { tag: t.definitionKeyword, color: p.blue },

      // ---- ORANGE (light) · names in use ----
      { tag: t.variableName, color: p.orangeLight },
      { tag: t.labelName, color: p.goldDeep },
      { tag: t.namespace, color: p.goldDeep },
      { tag: t.macroName, color: p.goldDeep },

      // ---- GOLD · names being born ----
      { tag: t.definition(t.variableName), color: p.gold },
      { tag: t.local(t.variableName), color: p.gold },

      // ---- BLUE (sky) · functions ----
      { tag: t.function(t.variableName), color: p.sky },
      { tag: t.function(t.definition(t.variableName)), color: p.sky },
      { tag: t.function(t.propertyName), color: p.sky },

      // ---- PINK · members ----
      { tag: t.propertyName, color: p.pink },
      { tag: t.definition(t.propertyName), color: p.pinkLight },
      { tag: t.special(t.propertyName), color: p.pinkDeep },
      { tag: t.definition(t.special(t.propertyName)), color: p.pinkDeep },

      // ---- TEAL · types, classes, builtins, literals of truth ----
      { tag: t.typeName, color: p.teal },
      { tag: t.definition(t.typeName), color: p.teal },
      { tag: t.className, color: p.teal },
      { tag: t.definition(t.className), color: p.teal },
      { tag: t.standard(t.variableName), color: p.teal },
      { tag: t.bool, color: p.teal },
      { tag: t.null, color: p.teal },
      { tag: t.self, color: p.teal },
      { tag: t.atom, color: p.teal },
      { tag: t.tagName, color: p.teal },
      { tag: t.attributeName, color: p.greenMuted },

      // ---- VIOLET (light) · constants ----
      { tag: t.constant(t.variableName), color: p.violetLight },

      // ---- GREEN · strings ----
      { tag: t.string, color: p.lime },
      { tag: t.special(t.string), color: p.lime },
      { tag: t.attributeValue, color: p.lime },
      { tag: t.monospace, color: p.lime },
      { tag: t.inserted, color: p.lime },
      { tag: t.escape, color: p.greenMuted },
      { tag: t.character, color: p.greenMuted },

      // ---- BLUE (sky) · regex / url / colour literals ----
      { tag: t.regexp, color: p.sky },
      { tag: t.url, color: p.sky },
      { tag: t.color, color: p.sky },
      { tag: t.link, color: p.sky, textDecoration: "underline" },

      // ---- GOLD (light) · numbers ----
      { tag: t.number, color: p.goldLight },
      { tag: t.integer, color: p.goldLight },
      { tag: t.float, color: p.goldLight },
      { tag: t.unit, color: p.goldLight },
      { tag: t.changed, color: p.gold },

      // ---- ORANGE · metadata ----
      { tag: t.meta, color: p.orange },
      { tag: t.documentMeta, color: p.orange },
      { tag: t.annotation, color: p.orange },
      { tag: t.processingInstruction, color: p.orange },

      // ---- NEUTRAL · operators and delimiters ----
      { tag: t.operator, color: p.dim },
      { tag: t.compareOperator, color: p.dim },
      { tag: t.arithmeticOperator, color: p.dim },
      { tag: t.logicOperator, color: p.dim },
      { tag: t.bitwiseOperator, color: p.dim },
      { tag: t.updateOperator, color: p.dim },
      { tag: t.definitionOperator, color: p.dim },
      { tag: t.typeOperator, color: p.dim },
      { tag: t.controlOperator, color: p.dim },
      { tag: t.derefOperator, color: p.dim },
      { tag: t.punctuation, color: p.dim },
      { tag: t.separator, color: p.dim },
      { tag: t.bracket, color: p.dim },
      { tag: t.angleBracket, color: p.dim },
      { tag: t.squareBracket, color: p.dim },
      { tag: t.paren, color: p.dim },
      { tag: t.brace, color: p.dim },
      { tag: t.contentSeparator, color: p.dim },

      // ---- NEUTRAL (white) · markup emphasis ----
      { tag: t.heading, color: p.white, fontWeight: "bold" },
      { tag: t.heading1, color: p.white, fontWeight: "bold" },
      { tag: t.heading2, color: p.white, fontWeight: "bold" },
      { tag: t.heading3, color: p.white, fontWeight: "bold" },
      { tag: t.list, color: p.white },
      { tag: t.quote, color: p.dim, fontStyle: "italic" },
      { tag: t.emphasis, color: p.white, fontStyle: "italic" },
      { tag: t.strong, color: p.white, fontWeight: "bold" },
      { tag: t.strikethrough, color: p.violet, textDecoration: "line-through" },

      // ---- State ----
      { tag: t.deleted, color: p.deleted },
      {
        tag: t.invalid,
        color: p.invalid,
        textDecoration: "underline wavy",
      },
    ];

    var highlightStyle = editorThemesApi.createHighlightStyle(rules);

    return editorThemesApi.createTheme({
      dark: IS_DARK,
      highlightStyle: highlightStyle,
      styles: {
        "&": {
          backgroundColor: p.background,
          color: p.foreground,
        },
        ".cm-content": {
          caretColor: p.caret,
          backgroundColor: p.background,
          color: p.foreground,
        },
        ".cm-cursor, .cm-dropCursor": {
          borderLeftColor: p.caret,
        },
        ".cm-selectionBackground, .cm-content ::selection": {
          backgroundColor: p.selectionBg,
        },
        "&.cm-focused > .cm-scroller > .cm-selectionLayer .cm-selectionBackground, .cm-selectionBackground, .cm-content ::selection": {
          backgroundColor: p.selectionBg,
        },
        ".cm-selectionMatch": {
          backgroundColor: p.selectionMatchBg,
          color: p.foreground,
        },
        ".cm-gutters": {
          backgroundColor: p.gutterBg,
          color: p.lineNumber,
          border: "none",
        },
        ".cm-lineNumbers .cm-gutterElement": {
          color: p.lineNumber,
        },
        ".cm-activeLineGutter": {
          backgroundColor: p.activeLine,
          color: p.activeLineNumber,
        },
        ".cm-activeLine": {
          backgroundColor: p.activeLine,
        },
        ".cm-matchingBracket": {
          backgroundColor: "transparent",
          border: "1px solid " + p.matchingBracket,
          color: p.foreground,
        },
        ".cm-nonmatchingBracket": {
          backgroundColor: "transparent",
          border: "1px solid " + p.nonMatchingBracket,
          color: p.foreground,
        },
        ".cm-searchMatch": {
          backgroundColor: p.searchMatch,
          color: p.background,
        },
        ".cm-searchMatch.cm-searchMatch-selected": {
          backgroundColor: p.searchMatchSelected,
          color: p.background,
        },
        ".cm-foldPlaceholder": {
          backgroundColor: p.foldPlaceholderBg,
          color: p.foldPlaceholderFg,
          border: "1px solid " + p.foreground,
          borderRadius: "2px",
          padding: "0 4px",
        },
        ".cm-panels": {
          backgroundColor: p.panelBg,
          color: p.panelFg,
        },
        ".cm-panels.cm-panels-top": {
          borderBottom: "1px solid " + p.panelBorder,
        },
        ".cm-panels.cm-panels-bottom": {
          borderTop: "1px solid " + p.panelBorder,
        },
        ".cm-tooltip": {
          backgroundColor: p.tooltipBg,
          color: p.tooltipFg,
          border: "1px solid " + p.tooltipBorder,
        },
        ".cm-tooltip.cm-tooltip-autocomplete > ul > li[aria-selected]": {
          backgroundColor: "rgba(120, 112, 222, 0.35)",
          color: p.foreground,
        },
        ".cm-scroller::-webkit-scrollbar": {
          width: "10px",
          height: "10px",
        },
        ".cm-scroller::-webkit-scrollbar-track": {
          backgroundColor: p.background,
        },
        ".cm-scroller::-webkit-scrollbar-thumb": {
          backgroundColor: p.scrollbarThumb,
          borderRadius: "5px",
        },
      },
    });
  }

  function registerCM6Theme() {
    if (cm6Registered) return;

    editorThemesApi = acode.require("editorThemes");

    editorThemesApi.register({
      id: THEME_ID,
      caption: THEME_CAPTION,
      name: THEME_CAPTION,
      dark: IS_DARK,
      getExtension: buildCM6Theme,
      config: {
        name: THEME_ID,
        dark: IS_DARK,
        background: palette.background,
        foreground: palette.foreground,
        keyword: palette.orange,
        string: palette.lime,
        number: palette.goldLight,
        comment: palette.violet,
        function: palette.sky,
        variable: palette.orangeLight,
        type: palette.teal,
        class: palette.teal,
        constant: palette.violetLight,
        operator: palette.dim,
        invalid: palette.invalid,
      },
    });

    cm6Registered = true;
  }

  acode.setPluginInit(PLUGIN_ID, function () {
    try {
      registerCM6Theme();
    } catch (e) {
      if (typeof console !== "undefined" && console.error) {
        console.error("[godot-colors] theme registration failed", e);
      }
    }
  });

  acode.setPluginUnmount(PLUGIN_ID, function () {
    try {
      if (editorThemesApi && cm6Registered) {
        editorThemesApi.unregister(THEME_ID);
      }
    } catch (e) {
      /* Ignore */
    }
  });
})();
