<?php

namespace App\Service;

class GreetingService
{
    public function greet(string $name): string
    {
        return "Hello, {$name}";
    }
}