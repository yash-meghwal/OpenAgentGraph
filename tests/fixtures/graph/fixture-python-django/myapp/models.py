from django.db import models

class User(models.Model):
    email = models.EmailField(max_length=255)

class Post(models.Model):
    title = models.CharField(max_length=200)
    author = models.ForeignKey(User, on_delete=models.CASCADE)