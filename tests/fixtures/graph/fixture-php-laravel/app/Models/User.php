<?php

namespace App\Models;

class User extends Model
{
    public function name(): string
    {
        return $this->full_name;
    }
}