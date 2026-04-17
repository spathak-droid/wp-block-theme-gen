import type { ThemeMeta } from '@/lib/style/profile'

/**
 * Build the `style.css` metadata header that WordPress requires at the root
 * of every theme. For a block theme the CSS rules are largely superseded by
 * `theme.json`, so we emit header metadata only (plus a one-line reset to
 * clear the default `list-style` that some browsers apply to `<ul>` in
 * nav contexts).
 *
 * WordPress parses this file's comment block for theme identity info:
 * Theme Name, Description, Author, Version, Requires at least,
 * Tested up to, Requires PHP, License, License URI, Text Domain.
 *
 * Ref: https://developer.wordpress.org/themes/releasing-your-theme/required-theme-files/
 */
export function buildStyleCss(meta: ThemeMeta): string {
  const header = [
    `Theme Name: ${meta.name}`,
    `Theme URI: https://example.com/${meta.slug}`,
    `Author: ${meta.author}`,
    `Author URI: https://example.com`,
    `Description: ${meta.description}`,
    `Version: ${meta.version}`,
    `Requires at least: ${meta.requiresAtLeast}`,
    `Tested up to: ${meta.testedUpTo}`,
    `Requires PHP: ${meta.requiresPhp}`,
    `License: ${meta.license}`,
    `License URI: ${meta.licenseUri}`,
    `Text Domain: ${meta.slug}`,
  ].join('\n')

  // A minimal runtime reset — theme.json handles almost everything, but
  // this clears a couple of stubborn defaults in nav menus and lists.
  const baseline = `
/*
 * Baseline overrides. Almost all styling lives in theme.json.
 * Only rules that can't be expressed there belong here.
 */
.wp-block-navigation ul { list-style: none; margin: 0; padding: 0; }
.wp-block-button__link { text-decoration: none; }
`

  return `/*\n${header}\n*/\n${baseline}`
}

/**
 * Build the `functions.php` content for a block theme. For MVP we only
 * need this file to register the pattern categories referenced by the
 * theme's patterns — WordPress silently ignores patterns whose category
 * is unregistered.
 */
export function buildFunctionsPhp(
  meta: ThemeMeta,
  patternCategories: Array<{ slug: string; label: string }>,
): string {
  const slugPrefix = meta.slug
  const categoryCalls = patternCategories
    .map(
      (c) =>
        `    register_block_pattern_category( '${slugPrefix}/${c.slug}', array( 'label' => __( '${escapePhpString(c.label)}', '${slugPrefix}' ) ) );`,
    )
    .join('\n')

  return `<?php
/**
 * ${meta.name} theme functions.
 *
 * @package ${meta.name}
 */

if ( ! defined( 'ABSPATH' ) ) { exit; }

if ( ! function_exists( '${slugPrefix.replace(/-/g, '_')}_register_pattern_categories' ) ) {
  function ${slugPrefix.replace(/-/g, '_')}_register_pattern_categories() {
${categoryCalls}
  }
  add_action( 'init', '${slugPrefix.replace(/-/g, '_')}_register_pattern_categories' );
}
`
}

/**
 * Build a placeholder `screenshot.svg` sized 1200×900 — convert to PNG
 * at packaging time if a real screenshot is not available. WordPress uses
 * this in the Themes admin.
 */
export function buildPlaceholderScreenshot(meta: ThemeMeta, accentColor: string): string {
  // Escape theme name for use inside an SVG text node.
  const name = meta.name.replace(/[<>&]/g, (c) =>
    c === '<' ? '&lt;' : c === '>' ? '&gt;' : '&amp;',
  )
  return `<?xml version="1.0" encoding="UTF-8"?>
<svg xmlns="http://www.w3.org/2000/svg" width="1200" height="900" viewBox="0 0 1200 900">
  <rect width="1200" height="900" fill="${accentColor}"/>
  <text x="600" y="450" font-family="system-ui, sans-serif" font-size="72" font-weight="700" fill="#ffffff" text-anchor="middle" dominant-baseline="middle">${name}</text>
</svg>`
}

function escapePhpString(s: string): string {
  return s.replace(/'/g, "\\'")
}
