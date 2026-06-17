require "mygem"

RSpec.describe Mygem::Runner do
  it "runs" do
    expect(Mygem::Runner.new.run).to eq("ok")
  end
end