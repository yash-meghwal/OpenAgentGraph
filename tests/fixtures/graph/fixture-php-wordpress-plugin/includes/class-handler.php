<?php

namespace FixturePlugin;

class Handler
{
    public function register(): void
    {
        add_filter('the_content', [$this, 'append_notice']);
    }

    public function append_notice(string $content): string
    {
        return $content;
    }
}