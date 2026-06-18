abstract class Base<T> {
  T read();
}

mixin Disposable {
  void dispose() {}
}

abstract class Cache<T> {
  void put(T value);
}

class Repository<T> extends Base<T> with Disposable implements Cache<T> {
  @override
  T read() => throw UnimplementedError();

  @override
  void put(T value) {}

  void save(T value) {
    put(value);
  }
}