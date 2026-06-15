package service

type Runner struct{}

func (r Runner) Run() string {
    return "ok"
}

func Run() {
    _ = Runner{}.Run()
}