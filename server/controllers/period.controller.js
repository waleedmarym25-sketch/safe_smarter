const pool = require('../config/db');

function formatDate(d) {
  if (!d) return null;
  if (typeof d === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(d)) return d;
  const dateObj = new Date(d);
  if (isNaN(dateObj.getTime())) return String(d);
  const year = dateObj.getFullYear();
  const month = String(dateObj.getMonth() + 1).padStart(2, '0');
  const day = String(dateObj.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

// 1. Get All User Cycles
exports.getUserCycles = async (req, res) => {
  try {
    const username = req.user.username;
    const query = `
      SELECT * FROM cycle_data 
      WHERE LOWER(user_id) = LOWER($1) 
      ORDER BY last_period_date DESC, id DESC 
      LIMIT 100;
    `;
    const result = await pool.query(query, [username]);
    const cycles = result.rows.map(row => ({
      ...row,
      last_period_date: formatDate(row.last_period_date)
    }));
    res.json({ success: true, count: cycles.length, cycles });
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
};

// 2. Log or Update a Period Cycle
exports.logCycle = async (req, res) => {
  try {
    const username = req.user.username;
    const {
      last_period_date,
      cycle_length,
      period_length,
      pain_level,
      pain_locations,
      fatigue_level,
      flow_intensity,
      ovulation_symptoms,
      symptoms,
      notes
    } = req.body;

    if (!last_period_date || !cycle_length || !period_length) {
      return res.status(400).json({ success: false, error: 'Period date, cycle length and period length are required' });
    }

    const insertQuery = `
      INSERT INTO cycle_data (
        user_id, 
        last_period_date, 
        cycle_length, 
        period_length, 
        pain_level, 
        pain_locations, 
        fatigue_level, 
        flow_intensity,
        ovulation_symptoms,
        symptoms, 
        notes
      ) 
      VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11) 
      RETURNING *;
    `;

    const dbResult = await pool.query(insertQuery, [
      username,
      last_period_date,
      parseInt(cycle_length),
      parseInt(period_length),
      parseInt(pain_level || 5),
      pain_locations || null,
      parseInt(fatigue_level || 5),
      flow_intensity || 'medium',
      ovulation_symptoms || null,
      symptoms || null,
      notes || null
    ]);

    const record = dbResult.rows[0];
    record.last_period_date = formatDate(record.last_period_date);

    res.json({ success: true, saved_record: record });
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
};

// 3. Delete a Cycle Record
exports.deleteCycle = async (req, res) => {
  try {
    const username = req.user.username;
    const { id } = req.params;

    const delResult = await pool.query(
      'DELETE FROM cycle_data WHERE id = $1 AND LOWER(user_id) = LOWER($2) RETURNING id',
      [id, username]
    );

    if (delResult.rows.length === 0) {
      return res.status(404).json({ success: false, error: 'Record not found or unauthorized' });
    }

    res.json({ success: true, message: 'Record deleted successfully' });
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
};

// 4. Period Analytics, Smart Weighted Predictions & Regularity
exports.getAnalytics = async (req, res) => {
  try {
    const username = req.user.username;

    const userRes = await pool.query('SELECT * FROM users WHERE LOWER(username) = LOWER($1)', [username]);
    const user = userRes.rows[0] || { username, display_name: username, default_cycle_length: 28, default_period_length: 5 };

    const cyclesRes = await pool.query(`
      SELECT * FROM cycle_data 
      WHERE LOWER(user_id) = LOWER($1) 
      ORDER BY last_period_date DESC 
      LIMIT 50
    `, [username]);

    const cycles = cyclesRes.rows.map(c => ({
      ...c,
      last_period_date: formatDate(c.last_period_date)
    }));

    let totalCycles = cycles.length;
    let avgCycle = user.default_cycle_length || 28;
    let avgPeriod = user.default_period_length || 5;
    let latestCycle = null;
    let nextPeriodDate = null;
    let daysUntilNext = null;
    let ovulationDate = null;
    let fertileStart = null;
    let fertileEnd = null;
    let isRegular = true;
    let variance = 0;

    if (totalCycles > 0) {
      latestCycle = cycles[0];

      // Weighted moving average - giving recent cycles higher priority
      let weightedSum = 0;
      let weightTotal = 0;
      const recentForWeight = cycles.slice(0, 6);
      recentForWeight.forEach((c, idx) => {
        const weight = recentForWeight.length - idx;
        weightedSum += (parseInt(c.cycle_length) || 28) * weight;
        weightTotal += weight;
      });
      avgCycle = Math.round(weightedSum / weightTotal);

      const sumPeriod = cycles.reduce((acc, c) => acc + (parseInt(c.period_length) || 5), 0);
      avgPeriod = Math.round(sumPeriod / totalCycles);

      if (totalCycles >= 2) {
        const diffs = cycles.map(c => Math.pow((parseInt(c.cycle_length) || 28) - avgCycle, 2));
        const varianceVal = diffs.reduce((a, b) => a + b, 0) / totalCycles;
        const stdDev = Math.sqrt(varianceVal);
        variance = parseFloat(stdDev.toFixed(1));

        if (stdDev > 3.5 || avgCycle < 21 || avgCycle > 36) {
          isRegular = false;
        }
      }

      const lastDate = new Date(latestCycle.last_period_date);
      if (!isNaN(lastDate.getTime())) {
        const nextDate = new Date(lastDate);
        nextDate.setDate(nextDate.getDate() + avgCycle);
        nextPeriodDate = formatDate(nextDate);

        const today = new Date();
        today.setHours(0, 0, 0, 0);
        nextDate.setHours(0, 0, 0, 0);
        daysUntilNext = Math.ceil((nextDate - today) / (1000 * 60 * 60 * 24));

        const ovu = new Date(lastDate);
        ovu.setDate(ovu.getDate() + (avgCycle - 14));
        ovulationDate = formatDate(ovu);

        const fStart = new Date(ovu);
        fStart.setDate(fStart.getDate() - 3);
        fertileStart = formatDate(fStart);

        const fEnd = new Date(ovu);
        fEnd.setDate(fEnd.getDate() + 2);
        fertileEnd = formatDate(fEnd);
      }
    }

    res.json({
      success: true,
      user_id: username,
      user_name: user.display_name || username,
      user_profile: {
        age: user.age,
        weight: user.weight,
        height: user.height,
        bmi: user.bmi
      },
      total_cycles: totalCycles,
      avg_cycle_length: avgCycle,
      avg_period_length: avgPeriod,
      latest_period_date: latestCycle ? latestCycle.last_period_date : null,
      latest_pain_level: latestCycle ? latestCycle.pain_level : 5,
      latest_pain_locations: latestCycle ? latestCycle.pain_locations : null,
      latest_flow_intensity: latestCycle ? latestCycle.flow_intensity : 'medium',
      latest_ovulation_symptoms: latestCycle ? latestCycle.ovulation_symptoms : null,
      latest_fatigue_level: latestCycle ? latestCycle.fatigue_level : 5,
      next_period_date: nextPeriodDate,
      days_until_next: daysUntilNext,
      ovulation_date: ovulationDate,
      fertile_window: fertileStart && fertileEnd ? `${fertileStart} - ${fertileEnd}` : null,
      fertile_start: fertileStart,
      fertile_end: fertileEnd,
      is_regular: isRegular,
      cycle_variance: variance,
      recent_cycles: cycles.slice(0, 10),
      all_cycles: cycles
    });
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
};
