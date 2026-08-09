export default function Settings() {
  return (
    <div className="flex-col gap-6">
      <div className="flex justify-between items-center mb-4">
        <h2 className="text-2xl font-bold">Settings</h2>
      </div>

      <div className="card">
        <h3 className="font-semibold mb-4 text-lg">Profile</h3>
        <div className="flex-col gap-4">
          <div>
            <label className="label">Full Name</label>
            <input className="input" type="text" placeholder="Your Name" />
          </div>
          <div>
            <label className="label">Company</label>
            <input className="input" type="text" placeholder="Company Name" />
          </div>
          <div>
            <label className="label">Role</label>
            <input className="input" type="text" placeholder="Your Role" />
          </div>
          <button className="btn-primary mt-2" style={{ alignSelf: 'flex-start' }}>Save Changes</button>
        </div>
      </div>
    </div>
  );
}
