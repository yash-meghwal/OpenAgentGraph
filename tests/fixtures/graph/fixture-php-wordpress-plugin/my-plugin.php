<?php
/**
 * Plugin Name: Fixture Plugin
 */

require_once __DIR__ . '/includes/class-handler.php';

add_action('init', 'fixture_plugin_bootstrap');

function fixture_plugin_bootstrap() {
    new FixturePlugin\Handler();
}