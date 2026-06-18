<?php

namespace App\Controller;

use App\Service\GreetingService;

class HomeController
{
    public function __construct(private GreetingService $greetingService)
    {
    }

    public function index(): string
    {
        return $this->greetingService->greet('world');
    }
}