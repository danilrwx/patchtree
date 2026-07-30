import Foundation

struct GPUMetrics {
    let uuid: String
    let utilization: Double
    let memoryUsed: UInt64

    var isSaturated: Bool {
        utilization > 0.9
    }
}

func summarize(_ samples: [GPUMetrics]) -> String {
    let busy = samples.filter { $0.isSaturated }.count
    return "\(busy)/\(samples.count) GPUs saturated"
}
