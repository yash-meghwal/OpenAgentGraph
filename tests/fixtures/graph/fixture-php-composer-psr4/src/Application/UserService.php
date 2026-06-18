<?php

namespace App\Application;

use App\Domain\User as DomainUser;

class UserService
{
    public function create(string $name): DomainUser
    {
        return new DomainUser($name);
    }
}