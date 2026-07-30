# Legacy ruby reporter, superseded by the Go controller.
class Reporter
  def initialize(nodes)
    @nodes = nodes
  end

  def report
    @nodes.map { |n| "#{n}: ok" }.join("\n")
  end
end
