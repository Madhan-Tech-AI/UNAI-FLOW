export default function Dashboard() {
  return (
    <div className="flex-col gap-6">
      <div className="flex justify-between items-center">
        <h2 className="text-2xl font-bold">Dashboard</h2>
      </div>

      <div className="flex gap-4">
        <div className="card w-full">
          <h3 className="text-secondary font-semibold text-sm">Total Automations</h3>
          <p className="text-2xl font-bold mt-2">0</p>
        </div>
        <div className="card w-full">
          <h3 className="text-secondary font-semibold text-sm">Connected Platforms</h3>
          <p className="text-2xl font-bold mt-2">0</p>
        </div>
        <div className="card w-full">
          <h3 className="text-secondary font-semibold text-sm">Posts Published</h3>
          <p className="text-2xl font-bold mt-2">0</p>
        </div>
      </div>

      <div className="card mt-4">
        <h3 className="font-semibold mb-4">Recent Automations</h3>
        <div className="text-center py-8 text-secondary">
          <p>No automations yet.</p>
        </div>
      </div>
    </div>
  );
}
