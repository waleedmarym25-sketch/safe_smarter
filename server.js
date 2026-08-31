const express = require('express');
const path = require('path');
const fs = require('fs');
const { Pool } = require('pg');
const cors = require('cors');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
require('dotenv').config();

const app = express();
app.use(cors());
app.use(express.json());

// Serve static frontend files from client's production build
app.use(express.static(path.join(__dirname, '../client/dist')));
app.use(express.static(path.join(__dirname, 'client/dist')));

const JWT_SECRET = process.env.JWT_SECRET || 'safe_secret_jwt_key_2026_super_secure_token_key';

// 🗄️ الاتصال المباشر بقاعدة البيانات SAFE
const pool = new Pool({
  user: process.env.DB_USER || 'postgres',
  host: process.env.DB_HOST || 'localhost',
  database: process.env.DB_DATABASE || 'SAFE', 
  password: process.env.DB_PASSWORD || '112004ma',
  port: parseInt(process.env.DB_PORT || '5432'),
});

// تهيئة جداول المستخدمين والدورات الشهرية مع الأعمدة الجديدة الشاملة
async function initDb() {
  try {
    // 1. جدول المستخدمين (مع العمر والوزن والطول وBMI)
    await pool.query(`
      CREATE TABLE IF NOT EXISTS users (
        id SERIAL PRIMARY KEY,
        username VARCHAR(100) UNIQUE NOT NULL,
        email VARCHAR(150) UNIQUE,
        password VARCHAR(255) NOT NULL,
        display_name VARCHAR(150),
        age INT,
        weight NUMERIC,
        height NUMERIC,
        bmi NUMERIC,
        default_cycle_length INT DEFAULT 28,
        default_period_length INT DEFAULT 5,
        notifications_enabled BOOLEAN DEFAULT true,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      );
    `);

    await pool.query(`
      ALTER TABLE users ADD COLUMN IF NOT EXISTS age INT;
      ALTER TABLE users ADD COLUMN IF NOT EXISTS weight NUMERIC;
      ALTER TABLE users ADD COLUMN IF NOT EXISTS height NUMERIC;
      ALTER TABLE users ADD COLUMN IF NOT EXISTS bmi NUMERIC;
      ALTER TABLE users ADD COLUMN IF NOT EXISTS default_cycle_length INT DEFAULT 28;
      ALTER TABLE users ADD COLUMN IF NOT EXISTS default_period_length INT DEFAULT 5;
      ALTER TABLE users ADD COLUMN IF NOT EXISTS notifications_enabled BOOLEAN DEFAULT true;
    `);

    // 2. جدول بيانات الدورة الشهرية (مع غزارة النزيف وأعراض التبويض)
    await pool.query(`
      CREATE TABLE IF NOT EXISTS cycle_data (
        id SERIAL PRIMARY KEY,
        user_id VARCHAR(100) NOT NULL,
        last_period_date DATE NOT NULL,
        cycle_length INT NOT NULL,
        period_length INT NOT NULL,
        pain_level INT DEFAULT 5,
        pain_locations TEXT,
        fatigue_level INT DEFAULT 5,
        flow_intensity VARCHAR(50) DEFAULT 'medium',
        ovulation_symptoms TEXT,
        symptoms TEXT,
        notes TEXT,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      );
    `);

    await pool.query(`
      ALTER TABLE cycle_data ADD COLUMN IF NOT EXISTS pain_level INT DEFAULT 5;
      ALTER TABLE cycle_data ADD COLUMN IF NOT EXISTS pain_locations TEXT;
      ALTER TABLE cycle_data ADD COLUMN IF NOT EXISTS fatigue_level INT DEFAULT 5;
      ALTER TABLE cycle_data ADD COLUMN IF NOT EXISTS flow_intensity VARCHAR(50) DEFAULT 'medium';
      ALTER TABLE cycle_data ADD COLUMN IF NOT EXISTS ovulation_symptoms TEXT;
      ALTER TABLE cycle_data ADD COLUMN IF NOT EXISTS symptoms TEXT;
      ALTER TABLE cycle_data ADD COLUMN IF NOT EXISTS notes TEXT;
    `);

    const defaultPasswordHash = await bcrypt.hash('123456', 10);
    
    await pool.query(`
      INSERT INTO users (username, email, password, display_name, age, weight, height, default_cycle_length, default_period_length)
      VALUES 
        ('sarah', 'sarah@safe.com', $1, 'Sarah Ahmed / سارة أحمد', 24, 60, 165, 28, 5),
        ('nada', 'nada@safe.com', $1, 'Nada Khaled / ندى خالد', 27, 68, 168, 30, 6)
      ON CONFLICT (username) DO UPDATE 
        SET password = COALESCE(users.password, EXCLUDED.password);
    `, [defaultPasswordHash]);

    console.log('✅ تم تهيئة قاعدة بيانات SAFE بنجاح وتحديث الجداول');
  } catch (err) {
    console.error('⚠️ خطأ أثناء تهيئة قاعدة البيانات:', err.message);
  }
}

// دالة التحقق من التوكن وحماية الروابط (Auth Middleware)
function authenticateToken(req, res, next) {
  const authHeader = req.headers['authorization'] || req.headers['x-auth-token'];
  const token = authHeader && (authHeader.startsWith('Bearer ') ? authHeader.split(' ')[1] : authHeader);

  if (!token) {
    return res.status(401).json({ success: false, error: 'يرجى تسجيل الدخول أولاً / Unauthorized access' });
  }

  jwt.verify(token, JWT_SECRET, (err, decoded) => {
    if (err) {
      return res.status(403).json({ success: false, error: 'جلسة العمل منتهية الصلاحية / Invalid or expired token' });
    }
    req.user = decoded;
    next();
  });
}

function normalizeArabicNumbers(str) {
  if (!str) return '';
  const arabicDigits = ['٠','١','٢','٣','٤','٥','٦','٧','٨','٩'];
  const persianDigits = ['۰','۱','۲','۳','۴','۵','۶','۷','۸','۹'];
  let res = str.toString();
  arabicDigits.forEach((d, i) => { res = res.replaceAll(d, i.toString()); });
  persianDigits.forEach((d, i) => { res = res.replaceAll(d, i.toString()); });
  return res;
}

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

// 🧠 محرك استخراج البيانات المتقدم والشامل
function parseCycleData(text) {
  if (!text) return {};
  const cleanText = normalizeArabicNumbers(text);
  
  let date = null;
  let cycleLength = null;
  let periodLength = null;
  let painLevel = null;
  let painLocations = [];
  let flowIntensity = null;
  let ovulationSymptoms = [];
  let fatigueLevel = null;

  // 1. استخراج التاريخ
  const isoMatch = cleanText.match(/\b(20\d\d)[-\/.](0?[1-9]|1[0-2])[-\/.]([12]\d|3[01]|0?[1-9])\b/);
  if (isoMatch) {
    const y = isoMatch[1];
    const m = isoMatch[2].padStart(2, '0');
    const d = isoMatch[3].padStart(2, '0');
    date = `${y}-${m}-${d}`;
  } else {
    const dmyMatch = cleanText.match(/\b([12]\d|3[01]|0?[1-9])[-\/.](0?[1-9]|1[0-2])[-\/.](20\d\d)\b/);
    if (dmyMatch) {
      const d = dmyMatch[1].padStart(2, '0');
      const m = dmyMatch[2].padStart(2, '0');
      const y = dmyMatch[3];
      date = `${y}-${m}-${d}`;
    }
  }

  // شهور عربية
  if (!date) {
    const arabicMonths = {
      'يناير': '01', 'فبراير': '02', 'مارس': '03', 'أبريل': '04', 'ابريل': '04',
      'مايو': '05', 'يونيو': '06', 'يوليو': '07', 'أغسطس': '08', 'اغسطس': '08',
      'سبتمبر': '09', 'أكتوبر': '10', 'اكتوبر': '10', 'نوفمبر': '11', 'ديسمبر': '12'
    };
    const monthRegex = /(?:و?يوم\s*)?([12]\d|3[01]|0?[1-9])\s*(?:من\s*)?(يناير|فبراير|مارس|أبريل|ابريل|مايو|يونيو|يوليو|أغسطس|اغسطس|سبتمبر|أكتوبر|اكتوبر|نوفمبر|ديسمبر)(?:\s*(?:عام|سنة\s*)?(20\d\d))?/i;
    const monthMatch = cleanText.match(monthRegex);
    if (monthMatch) {
      const d = monthMatch[1].padStart(2, '0');
      const m = arabicMonths[monthMatch[2]];
      const y = monthMatch[3] || '2026';
      date = `${y}-${m}-${d}`;
    }
  }

  // شهور إنجليزية
  if (!date) {
    const engMonths = {
      'jan': '01', 'january': '01', 'feb': '02', 'february': '02', 'mar': '03', 'march': '03',
      'apr': '04', 'april': '04', 'may': '05', 'jun': '06', 'june': '06', 'jul': '07', 'july': '07',
      'aug': '08', 'august': '08', 'sep': '09', 'september': '09', 'oct': '10', 'october': '10',
      'nov': '11', 'november': '11', 'dec': '12', 'december': '12'
    };
    const engRegex = /(?:on\s+)?(january|february|march|april|may|june|july|august|september|october|november|december|jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec)\s+([12]\d|3[01]|0?[1-9])(?:st|nd|rd|th)?(?:\s*,?\s*(20\d\d))?/i;
    const em = cleanText.match(engRegex);
    if (em) {
      const m = engMonths[em[1].toLowerCase()];
      const d = em[2].padStart(2, '0');
      const y = em[3] || '2026';
      date = `${y}-${m}-${d}`;
    }
  }

  if (!date && (cleanText.includes('اليوم') || cleanText.toLowerCase().includes('today'))) {
    date = new Date().toISOString().split('T')[0];
  }

  // 2. طول الدورة
  const cyclePatterns = [
    /(?:و?(?:طول|متوسط)\s*الدورة|و?دورة\s*طولها|و?طولها|و?دورتي\s*كل|و?دورتي|و?كل)\s*(?:هو|كان|:|=)?\s*(\d{1,2})\b/i,
    /(?:cycle\s*length|cycle|average\s*cycle)\s*(?:is|was|of|:|=)?\s*(\d{1,2})\b/i,
    /(\d{1,2})\s*(?:يوم|ايام|أيام|days?|day)\s*(?:طول|دورة|كل|cycle|long)/i,
    /(?:every|كل)\s*(\d{1,2})\s*(?:يوم|ايام|أيام|days?)/i
  ];
  for (const p of cyclePatterns) {
    const m = cleanText.match(p);
    if (m) {
      const val = parseInt(m[1]);
      if (val >= 15 && val <= 60) {
        cycleLength = val;
        break;
      }
    }
  }

  // 3. مدة الحيض
  const periodPatterns = [
    /(?:و?مدة\s*(?:الحيض|البريود|الدورة|النزول)|و?تستمر|و?مدة|و?المدة|و?مدتها)\s*(?:هي|كانت|:|=)?\s*(\d{1,2})\b/i,
    /(?:duration|period\s*duration|period\s*length|lasts?)\s*(?:is|was|of|for|:|=)?\s*(\d{1,2})\b/i,
    /(\d{1,2})\s*(?:أيام|ايام|يوم|days?|day)\s*(?:حيض|نزول|تستمر|duration|مدة|period|flow)/i,
    /(?:lasts?|duration|تستمر|تجلس|تقعد)\s*(?:for\s*)?(\d{1,2})\s*(?:أيام|ايام|يوم|days?)/i
  ];
  for (const p of periodPatterns) {
    const m = cleanText.match(p);
    if (m) {
      const val = parseInt(m[1]);
      if (val >= 1 && val <= 15) {
        periodLength = val;
        break;
      }
    }
  }

  // 4. مستوى الألم (1-10)
  const painMatch = cleanText.match(/(?:مستوى\s*(?:الألم|الالم|الشدة)|شدة\s*الألم|pain\s*level|pain\s*scale)[:\s=]*(\d{1,2})/i);
  if (painMatch) {
    const p = parseInt(painMatch[1]);
    if (p >= 1 && p <= 10) painLevel = p;
  }

  // 5. غزارة النزيف
  const lowerText = cleanText.toLowerCase();
  if (lowerText.includes('غزير جدا') || lowerText.includes('كتل') || lowerText.includes('very heavy') || lowerText.includes('clots')) {
    flowIntensity = 'very_heavy';
  } else if (lowerText.includes('غزير') || lowerText.includes('heavy')) {
    flowIntensity = 'heavy';
  } else if (lowerText.includes('خفيف جدا') || lowerText.includes('تنقيط') || lowerText.includes('spotting')) {
    flowIntensity = 'spotting';
  } else if (lowerText.includes('خفيف') || lowerText.includes('light')) {
    flowIntensity = 'light';
  } else if (lowerText.includes('متوسط') || lowerText.includes('عادي') || lowerText.includes('medium')) {
    flowIntensity = 'medium';
  }

  // 6. مواقع الألم
  if (lowerText.includes('بطن') || lowerText.includes('مغص') || lowerText.includes('abdomen') || lowerText.includes('cramps')) {
    painLocations.push('أسفل البطن');
  }
  if (lowerText.includes('ظهر') || lowerText.includes('back') || lowerText.includes('lower back')) {
    painLocations.push('أسفل الظهر');
  }
  if (lowerText.includes('صداع') || lowerText.includes('headache') || lowerText.includes('رأس')) {
    painLocations.push('صداع بالرأس');
  }
  if (lowerText.includes('إجهاد') || lowerText.includes('تعب') || lowerText.includes('ارهاق') || lowerText.includes('fatigue')) {
    painLocations.push('إجهاد عام بالجسم');
    fatigueLevel = 8;
  }

  // 7. أعراض التبويض
  if (lowerText.includes('إفرازات') || lowerText.includes('مخاط') || lowerText.includes('mucus') || lowerText.includes('discharge')) {
    ovulationSymptoms.push('إفرازات مطاطية شفافة');
  }
  if (lowerText.includes('نغز') || lowerText.includes('ألم بالجانب') || lowerText.includes('ovulation pain') || lowerText.includes('mittelschmerz')) {
    ovulationSymptoms.push('نغزات ألم بالجانب (التبويض)');
  }
  if (lowerText.includes('حرارة') || lowerText.includes('سخونة') || lowerText.includes('temperature')) {
    ovulationSymptoms.push('ارتفاع طفيف في حرارة الجسم');
  }
  if (lowerText.includes('نشاط') || lowerText.includes('طاقة') || lowerText.includes('high energy')) {
    ovulationSymptoms.push('زيادة الحيوية والنشاط');
  }

  return { 
    date, 
    cycleLength, 
    periodLength, 
    painLevel, 
    painLocations: painLocations.join('، '), 
    flowIntensity,
    ovulationSymptoms: ovulationSymptoms.join('، '),
    fatigueLevel 
  };
}

// 🌸 موسوعة الإجابات الطبية واللطيفة (Empathetic & Medical Expert Knowledge)
function getEmpatheticHealthReply(query, lang = 'ar', userName = 'حبيبتي') {
  const q = query.toLowerCase();

  // عدم انتظام الدورة والنصائح
  if (q.includes('غير منتظمة') || q.includes('تأخرت') || q.includes('لخبطة') || q.includes('عدم انتظام') || q.includes('irregular') || q.includes('delayed') || q.includes('late period') || q.includes('irreguli') || q.includes('unregel')) {
    if (lang === 'fr') {
      return `🌸 Chère amie, respirez profondément ! 💕 Avoir un cycle irrégulier ou en retard est très fréquent et normal sous l'effet du stress, du sommeil ou des variations hormonales.

🌿 **Conseils Bienveillants pour l'Équilibre Hormonal:**
1. **Gérer le Stress & le Cortisol:** Accordez-vous un moment de détente avec une tisane de camomille.
2. **Aliments Riches en Bons Lipides:** Avocats, noix, graines de lin et légumes verts.
3. **Tisanes Bienfaisantes:** Menthe douce, cannelle et gingembre pour stimuler la circulation.
4. **Sommeil Régulier:** 7-8 heures par nuit pour stabiliser la mélatonine.
5. **Quand Consulter:** Si le retard dépasse 3 mois consécutifs, un bilan gynécologique doux vous apportera sérénité. 💕`;
    } else if (lang === 'de') {
      return `🌸 Liebes, atme tief durch und entspanne dich! 💕 Ein unregelmäßiger oder verspäteter Zyklus ist sehr häufig und meist unbedenklich.

🌿 **Sanfte Tipps für die Hormonbalance:**
1. **Stress & Cortisol abbauen:** Gönne dir täglich Ruhepausen und Entspannungstees.
2. **Hormonfreundliche Ernährung:** Gesunde Fette (Avocados, Nüsse, Leinsamen) und frisches Gemüse.
3. **Wohltuende Kräutertees:** Minze, Zimt und Ingwer zur sanften Zyklusunterstützung.
4. **Schlafrhythmus:** 7-8 Stunden erholsamer Schlaf im dunklen Raum.
5. **Wann zum Arzt:** Bei Ausbleiben über 3 Monate gibt eine gynäkologische Abklärung Sicherheit. 💕`;
    } else if (lang === 'sw') {
      return `🌸 Rafiki mpendwa, vuta pumzi tulivu! 💕 Mzunguko kubadilika au kuchelewa ni jambo la kawaida linalosababishwa na msongo wa mawazo, usingizi au mabadiliko ya mwili.

🌿 **Ushauri Mpole wa Afya ya Homoni:**
1. **Punguza Msongo wa Mawazo:** Pumzika na unywe chai ya mitishamba yenye joto.
2. **Vyakula Bora:** Parachichi, mbegu za kitani, karanga na mboga za majani.
3. **Chai ya Mdalasini na Tangawizi:** Husaidia kurekebisha mzunguko wa damu kwa upole.
4. **Usingizi wa Kutosha:** Saa 7-8 kila usiku ili kuweka homoni sawa.
5. **Wakati wa Kumuona Daktari:** Mzunguko ukikosa kwa miezi 3, muone daktari kwa uchunguzi wa kawaida. 💕`;
    } else if (lang === 'en') {
      return `🌸 Sweetie, take a deep calming breath! 💕 Having an irregular or delayed cycle is very common and usually nothing to panic about. Our bodies respond sensitively to stress, sleep, travel, weight changes, and hormones.

🌿 **Gentle Care & Balance Tips for Irregular Cycles:**
1. **Manage Cortisol & Stress:** High stress is the #1 cause of temporary delays. Try 10 minutes of deep breathing or a cozy warm bath.
2. **Hormone-Nourishing Foods:** Include healthy fats (avocados, nuts, olive oil), seeds (flaxseeds, pumpkin seeds), and leafy greens.
3. **Herbal Teas:** Spearmint tea (great for balancing androgens), ginger, and cinnamon regulate blood flow.
4. **Consistent Sleep:** Aim for 7-8 hours in a dark, quiet room to keep your melatonin and LH hormones in rhythm.
5. **When to Check with a Doctor:** If your cycle is absent for 3+ consecutive months, or varies by more than 10-15 days regularly, a quick hormonal check (thyroid, PCOS, prolactin) with a kind gynecologist will bring you complete clarity and peace of mind!

✨ *You are beautiful, your body is doing its best, and we are tracking every step together!* 💕`;
    } else {
      return `🌸 خدي نفس عميق وهدي بالك خالص يا ${userName} يا قمر! 💕 عدم انتظام الدورة أو تأخرها أمر شائع جداً وبيحصل لأغلب البنات والنساء، وجسمنا حساس جداً لأي توتر، قلة نوم، تغيير وزن، أو ضغط نفسي.

🌿 **نصائح ذهبية ولطيفة للمساعدة على انتظام الدورة وتوازن الهرمونات:**
1. **تقليل التوتر وهرمون الكورتيزول:** التوتر هو السبب الأول لتأخر التبويض. ادّي لنفسكِ وقت استرخاء يومي، واشربي بابونج أو لافندر مهدئ.
2. **الأغذية الداعمة للتوازن الهرموني:** دهون صحية (أفوكادو، مكسرات نية، زيت زيتون)، وبذور الكتان والسمسم، مع تقليل السكريات المكررة.
3. **مشروبات عشبية منظمة:** مغلي القرفة، والزنجبيل، والنعناع البلدي (ممتاز جداً لتهدئة الهرمونات).
4. **النوم المنتظم:** النوم 7 إلى 8 ساعات يومياً في وقت مبكر يساعد الغدة النخامية على تنظيم هرمونات الدورة بدقة.
5. **متى تستشيرين طبيبة نساء؟:** لو انقطعت الدورة أكثر من 3 أشهر متتالية أو كان التباين يزيد عن 15 يوماً باستمرار، فحص بسيط لهرمونات الغدة وتكيس المبايض (PCOS) هيطمنكِ تماماً ويديكي العلاج المناسب بكل سهولة!

✨ *أنتِ غالية وجسمكِ بيحاول يتأقلم، حبي نفسكِ ودلعيها ودايماً سجلي بياناتكِ هنا عشان نتابع مع بعض خطوة بخطوة!* 💕`;
    }
  }

  // أعراض التبويض والخصوبة
  if (q.includes('تبويض') || q.includes('خصوبة') || q.includes('ovulation') || q.includes('fertile') || q.includes('mittelschmerz') || q.includes('eisprung') || q.includes('upevushaji')) {
    if (lang === 'fr') {
      return `🌸 Comprendre votre fenêtre d'ovulation est un merveilleux moyen d'écouter votre corps ! 💕

⭐ **Signes Clés de l'Ovulation:**
1. **Glaire Cervicale Transparente:** Élastique et semblable au blanc d'œuf.
2. **Légère Douleur Pelvienne:** Pincement doux d'un côté du bas-ventre.
3. **Énergie & Teint Radieux:** Le pic d'œstrogène procure vitalité et éclat naturel.
4. **Température Basale:** Légère élévation de 0,3°C à 0,5°C après la libération de l'ovule.

✨ *Hydratez-vous bien et profitez de cette belle énergie aujourd'hui !* 💕`;
    } else if (lang === 'de') {
      return `🌸 Das Verständnis deines Eisprungs hilft dir, im Einklang mit deinem Körper zu leben! 💕

⭐ **Wichtige Anzeichen für den Eisprung:**
1. **Zervixschleim-Veränderung:** Klar, dehnbar wie rohes Eiweiß.
2. **Mittelschmerz:** Ein sanftes Ziehen auf einer Seite des Unterleibs.
3. **Energie & Strahlen:** Höchststand an Östrogen bringt Frische und Vitalität.
4. **Basaltemperatur:** Ein leichter Anstieg um 0,3°C - 0,5°C nach dem Eisprung.

✨ *Trinke viel Wasser und genieße deine Energie!* 💕`;
    } else if (lang === 'sw') {
      return `🌸 Kuelewa dirisha lako la upevushaji mayai ni njia nzuri ya kufahamu afya ya mwili wako! 💕

⭐ **Dalili Kuu za Upevushaji Mayai:**
1. **Ute wa Mlango wa Uzazi:** Mwororo na unavutika kama ute wa yai bichi.
2. **Maumivu Madogo Upande Mmoja:** Mchomo mdogo chini ya tumbo wakati yai linapotoka.
3. **Nguvu na Mwangaza wa Ngozi:** Kiwango cha homoni huleta uchangamfu na furaha.
4. **Joto la Mwili:** Hupanda kidogo kwa digrii 0.3°C - 0.5°C baada ya yai kupevuka.

✨ *Kunywa maji mengi na furahia siku yako nzuri!* 💕`;
    } else if (lang === 'en') {
      return `🌸 Understanding your ovulation window is such a wonderful way to connect with your body's rhythm! 💕

⭐ **Key Signs & Symptoms of Ovulation:**
1. **Cervical Mucus Changes:** Clear, stretchy, egg-white consistency discharge.
2. **Mild Pelvic Twings (Mittelschmerz):** A brief, mild pinch or ache on one side of the lower abdomen.
3. **Energy & Glow Boost:** Natural rise in estrogen creates glowing skin, vibrant mood, and high libido.
4. **Basal Body Temperature:** A slight 0.3°C - 0.5°C rise right after the egg is released.

✨ *During this phase, keep hydrated, eat antioxidant-rich berries, and celebrate your vibrant energy!* 💕`;
    } else {
      return `🌸 فهم فترة التبويض من أجمل الطرق لمعرفة لغة جسمكِ وصحتكِ يا ${userName}! 💕

⭐ **أبرز علامات وأعراض فترة التبويض (Ovulation Signs):**
1. **الإفرازات الشفافة المطاطية:** بتشبه بياض البيض الني وبتكون لزجة ومطاطية لتسهيل حركة الحيوانات المنوية.
2. **نغزات خفيفة في أحد الجانبين:** ألم خفيف وناعم أسفل اليمين أو اليسار من البطن لحظة خروج البويضة من المبيض.
3. **زيادة الطاقة وإشراقة البشرة:** هرمون الإستروجين بيوصل لقمته، فبتحسي بنشاط، ثقة، وانتعاش بالمزاج.
4. **ارتفاع طفيف بحرارة الجسم:** ارتفاع بسيط جداً بحوالي نصف درجة مئوية بعد خروج البويضة.

✨ *اشربي مياه كتير، كلي خضار ورقي وفواكه غنية بمضادات الأكسدة، واستمتعي بحيويتكِ وتألقكِ اليوم!* 💕`;
    }
  }

  // المسكنات والراحة
  if (q.includes('مسكن') || q.includes('مسكنات') || q.includes('وجع') || q.includes('ألم') || q.includes('مغص') || q.includes('تقلص') || 
      q.includes('pain') || q.includes('cramp') || q.includes('cramps') || q.includes('panadol') || q.includes('brufen') ||
      q.includes('douleur') || q.includes('schmerz') || q.includes('maumivu')) {
    if (lang === 'fr') {
      return `🌸 Courage chère amie, voici les conseils médicaux bienveillants pour apaiser les douleurs : 💕

💊 **Analgésiques Sûrs et Recommandés :**
1. **Ibuprofène (Brufen 400mg) :** Anti-inflammatoire très efficace contre les crampes utérines (à prendre après un repas).
2. **Paracétamol (Doliprane / Panadol) :** Très doux pour l'estomac pour les douleurs légères et maux de tête.
3. **Acide Méfénamique (Ponstan 500mg) :** Cible spécifiquement les spasmes utérins.

🍵 **Confort Naturel à la Maison :**
• **Bouillotte Chaude :** Sur le bas-ventre pour détendre instantanément les muscles.
• **Tisanes Chaudes :** Cannelle, menthe douce, ou gingembre au miel.
• **Chocolat Noir & Magnésium :** Réduit les spasmes et libère des endorphines ! 💕`;
    } else if (lang === 'de') {
      return `🌸 Liebe Grüße und viel Wärme für dich! 💕 Hier sind sichere Schmerzlinderungstipps:

💊 **Sichere Schmerzmittel:**
1. **Ibuprofen (400mg):** Hemmt Gebärmutterkrämpfe effektiv (nach den Mahlzeiten einnehmen).
2. **Paracetamol:** Magenschonend bei leichten Kopf- und Bauchschmerzen.
3. **Naproxen:** Langanhaltende Linderung für die Nacht.

🍵 **Natürliche Hausmittel:**
• **Wärmflasche:** Auf den Unterbauch legen für schnelle Entspannung.
• **Kräutertees:** Zimt, Kamille und Pfefferminztee.
• **Dunkle Schokolade:** Reich an Magnesium zur Krampflinderung ! 💕`;
    } else if (lang === 'sw') {
      return `🌸 Pole sana mpendwa, pokea upendo na faraja! 💕 Hapa kuna njia salama za kutuliza maumivu ya hedhi:

💊 **Dawa Salama za Maumivu:**
1. **Ibuprofen (400mg):** Hupunguza mikazo ya mfuko wa uzazi (tumia baada ya chakula).
2. **Paracetamol (Panadol):** Mpole kwa tumbo kwa maumivu ya kawaida na kichwa.

🍵 **Tiba za Asili Nyumbani:**
• **Chupa ya Maji ya Moto:** Weka kwenye tumbo la chini ili kulegeza misuli.
• **Chai ya Mdalasini na Tangawizi:** Hupunguza maumivu haraka.
• **Chokoleti Nyeusi na Maji ya Uvuguvugu:** Husaidia mwili kutulia! 💕`;
    } else if (lang === 'en') {
      return `🌸 Oh sweetie, sending you lots of warmth and love! 💕 Menstrual cramps can be tough, but remember you are incredibly strong. Here are safe pain relief tips:

💊 **Safe & Approved Over-the-Counter Painkillers:**
1. **Ibuprofen (Advil / Brufen 400mg):** Excellent anti-inflammatory for uterine cramps (best taken after a meal).
2. **Paracetamol (Panadol / Tylenol):** Very gentle on the stomach for mild to moderate pain and headache.
3. **Naproxen (Aleve):** Long-lasting relief for intense cramps.
4. **Mefenamic Acid (Ponstan):** Specifically targets prostaglandin pain.

🍵 **Natural Comfort & Home Remedies:**
• **Warm Heating Pad:** Place it on your lower abdomen or back for instant soothing.
• **Herbal Teas:** Cinnamon tea, warm ginger with honey, chamomile, or peppermint.
• **Hydration & Magnesium:** Drink plenty of warm water, and enjoy a piece of dark chocolate 🍫!

✨ *Take a deep breath, snuggle into warm comfy clothes, and get some good rest today!* 💕`;
    } else {
      return `🌸 ألف سلامة عليكِ يا ${userName} يا قمر، قلبي معاكِ وربنا يخفف عنكِ يا رب! 💕 تقلصات الدورة بتكون صعبة أحياناً، بس أنتِ بطلة وقدها، ودلعي نفسكِ النهاردة. إليكِ أهم المسكنات الآمنة والخطوات اللطيفة:

💊 **المسكنات المسموحة والآمنة لتسكين ألم الدورة:**
1. **إيبوبروفين (Brufen / Profen 400mg):** ممتاز جداً لتقليل انقباضات الرحم والالتهاب (يُفضل دائماً بعد الأكل).
2. **باراسيتامول (Panadol / Adol):** خفيف جداً على المعدة ومناسب للألم والصداع الخفيف والمتوسط.
3. **نابروكسين (Naproxen / Aleve):** مفعوله طويل وممتاز للتقلصات الشديدة.
4. **حمض الميفيناميك (Ponstan 500mg):** مسكن متخصص ومباشر لآلام الدورة الشهرية.

🍵 **طرق طبيعية مساعدة تشعركِ بالراحة فوراً:**
• **كمادات مياه دافئة (قربة دافئة):** ضعيها على أسفل البطن أو الظهر، بتعمل معجزات في فك الانقباضات!
• **المشروبات الدافئة اللطيفة:** مشروب القرفة، الزنجبيل مع ملعقة عسل، النعناع، والبابونج المهدئ.
• **شوكولاتة داكنة 🍫 ومياه دافئة:** الشوكولاتة الداكنة غنية بالماغنسيوم وبتحسن المزاج فوراً.

✨ *خدي راحة تامة، ارتدي ملابس واسعة ومريحة، ومتضغطيش على نفسكِ أبداً في أي مجهود يا جميلة!* 💕`;
    }
  }

  return null;
}

// دالة الربط الذكي مع الذكاء الاصطناعي Aimicromind
async function processWithAI(userMessage, lang = 'ar', userName = 'حبيبتي') {
  const customEmpathetic = getEmpatheticHealthReply(userMessage, lang, userName);
  if (customEmpathetic) {
    return { aiReply: customEmpathetic };
  }

  const aimicromindUrl = "https://core.aimicromind.com/api/v1/prediction/d3105b42-6b2a-46cd-9f64-31e071744791";
  let aiReply = lang === 'en' 
    ? `Your health details have been recorded safely in your private database, sweetie! 💕 Take good care of yourself today!`
    : `تم تسجيل بياناتكِ بكل حب في قاعدة بياناتكِ الخاصة SAFE يا ${userName}! 💕 متنسيش تشربي سوائل دافية وتاخدي راحة كاملة.`;

  try {
    const response = await fetch(aimicromindUrl, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Accept": "application/json",
        "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36"
      },
      body: JSON.stringify({ question: userMessage })
    });

    const responseText = await response.text();
    try {
      const aiResult = JSON.parse(responseText);
      if (aiResult.text) aiReply = aiResult.text;
    } catch (e) {}
  } catch (err) {
    console.log('⚠️ استخدام الرد اللطيف المحلي');
  }

  return { aiReply };
}

// 🏥 Health Check
app.get('/health', async (req, res) => {
  try {
    await pool.query('SELECT 1');
    res.json({
      status: 'ok',
      database: 'SAFE (PostgreSQL Connected)',
      port: 3000,
      timestamp: new Date().toISOString()
    });
  } catch (err) {
    res.status(500).json({ status: 'error', database: 'Disconnected', error: err.message });
  }
});

// ==========================================
// 🔐 APIs المصادقة والملف الشخصي (Auth & Profile APIs)
// ==========================================

app.post('/api/auth/register', async (req, res) => {
  try {
    const { username, email, password, display_name, age, weight, height, default_cycle_length, default_period_length } = req.body;

    if (!username || !password) {
      return res.status(400).json({ success: false, error: 'اسم المستخدم وكلمة المرور مطلوبان / Username and password are required' });
    }

    const cleanUsername = username.trim().toLowerCase();
    const cleanDisplayName = (display_name && display_name.trim()) || cleanUsername;
    const cleanEmail = (email && email.trim().toLowerCase()) || `${cleanUsername}@safe.com`;
    const userAge = age ? parseInt(age) : null;
    const userWeight = weight ? parseFloat(weight) : null;
    const userHeight = height ? parseFloat(height) : null;
    let bmi = null;
    if (userWeight && userHeight && userHeight > 0) {
      const hMeters = userHeight / 100;
      bmi = parseFloat((userWeight / (hMeters * hMeters)).toFixed(1));
    }
    const cycleLen = parseInt(default_cycle_length || 28);
    const periodLen = parseInt(default_period_length || 5);

    const existing = await pool.query('SELECT * FROM users WHERE LOWER(username) = $1 OR LOWER(email) = $2', [cleanUsername, cleanEmail]);
    if (existing.rows.length > 0) {
      return res.status(400).json({ success: false, error: 'اسم المستخدم أو البريد مسجل بالفعل / Username or Email already exists' });
    }

    const hashedPassword = await bcrypt.hash(password, 10);

    const insertQuery = `
      INSERT INTO users (username, email, password, display_name, age, weight, height, bmi, default_cycle_length, default_period_length)
      VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)
      RETURNING id, username, email, display_name, age, weight, height, bmi, default_cycle_length, default_period_length, notifications_enabled, created_at;
    `;
    const result = await pool.query(insertQuery, [cleanUsername, cleanEmail, hashedPassword, cleanDisplayName, userAge, userWeight, userHeight, bmi, cycleLen, periodLen]);
    const user = result.rows[0];

    const token = jwt.sign({ id: user.id, username: user.username, email: user.email }, JWT_SECRET, { expiresIn: '30d' });

    res.json({
      success: true,
      message: 'تم إنشاء الحساب بنجاح / Account created successfully',
      token,
      user
    });
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
});

app.post('/api/auth/login', async (req, res) => {
  try {
    const { identifier, password } = req.body;

    if (!identifier || !password) {
      return res.status(400).json({ success: false, error: 'يرجى إدخال اسم المستخدم وكلمة المرور / Identifier and password required' });
    }

    const cleanIdentifier = identifier.trim().toLowerCase();

    const result = await pool.query(
      'SELECT * FROM users WHERE LOWER(username) = $1 OR LOWER(email) = $1',
      [cleanIdentifier]
    );

    if (result.rows.length === 0) {
      return res.status(400).json({ success: false, error: 'بيانات الدخول غير صحيحة / Invalid credentials' });
    }

    const user = result.rows[0];
    const isMatch = await bcrypt.compare(password, user.password);

    if (!isMatch) {
      return res.status(400).json({ success: false, error: 'كلمة المرور غير صحيحة / Invalid credentials' });
    }

    const token = jwt.sign({ id: user.id, username: user.username, email: user.email }, JWT_SECRET, { expiresIn: '30d' });

    const safeUser = {
      id: user.id,
      username: user.username,
      email: user.email,
      display_name: user.display_name,
      age: user.age,
      weight: user.weight,
      height: user.height,
      bmi: user.bmi,
      default_cycle_length: user.default_cycle_length,
      default_period_length: user.default_period_length,
      notifications_enabled: user.notifications_enabled,
      created_at: user.created_at
    };

    res.json({
      success: true,
      message: 'تم تسجيل الدخول بنجاح / Logged in successfully',
      token,
      user: safeUser
    });
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
});

app.get('/api/auth/me', authenticateToken, async (req, res) => {
  try {
    const result = await pool.query(
      'SELECT id, username, email, display_name, age, weight, height, bmi, default_cycle_length, default_period_length, notifications_enabled, created_at FROM users WHERE LOWER(username) = LOWER($1)',
      [req.user.username]
    );
    if (result.rows.length === 0) {
      return res.status(404).json({ success: false, error: 'المستخدم غير موجود' });
    }
    res.json({ success: true, user: result.rows[0] });
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
});

// تحديث بيانات الملف الشخصي (العمر، الوزن، الطول، حساب BMI)
app.put('/api/my/profile', authenticateToken, async (req, res) => {
  try {
    const username = req.user.username;
    const { display_name, age, weight, height } = req.body;

    const userAge = age ? parseInt(age) : null;
    const userWeight = weight ? parseFloat(weight) : null;
    const userHeight = height ? parseFloat(height) : null;
    let bmi = null;
    if (userWeight && userHeight && userHeight > 0) {
      const hMeters = userHeight / 100;
      bmi = parseFloat((userWeight / (hMeters * hMeters)).toFixed(1));
    }

    const updateQuery = `
      UPDATE users 
      SET 
        display_name = COALESCE($1, display_name),
        age = COALESCE($2, age),
        weight = COALESCE($3, weight),
        height = COALESCE($4, height),
        bmi = COALESCE($5, bmi)
      WHERE LOWER(username) = LOWER($6)
      RETURNING id, username, email, display_name, age, weight, height, bmi, default_cycle_length, default_period_length, notifications_enabled;
    `;
    const result = await pool.query(updateQuery, [display_name || null, userAge, userWeight, userHeight, bmi, username]);

    res.json({
      success: true,
      message: 'تم تحديث الملف الشخصي ومؤشرات الجسم بنجاح',
      user: result.rows[0]
    });
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
});

// ==========================================
// 🔔 نظام الإشعارات الذكي (5-Day Pre-Period & Ovulation Alerts)
// ==========================================

app.get('/api/my/notifications', authenticateToken, async (req, res) => {
  try {
    const username = req.user.username;
    
    const userRes = await pool.query('SELECT * FROM users WHERE LOWER(username) = LOWER($1)', [username]);
    const user = userRes.rows[0] || { display_name: username, default_cycle_length: 28 };

    const cyclesRes = await pool.query(`
      SELECT * FROM cycle_data 
      WHERE LOWER(user_id) = LOWER($1) 
      ORDER BY last_period_date DESC 
      LIMIT 10
    `, [username]);

    let notification = null;

    if (cyclesRes.rows.length > 0) {
      const latestCycle = cyclesRes.rows[0];
      const avgCycle = latestCycle.cycle_length || user.default_cycle_length || 28;
      const lastDate = new Date(latestCycle.last_period_date);

      if (!isNaN(lastDate.getTime())) {
        const nextDate = new Date(lastDate);
        nextDate.setDate(nextDate.getDate() + avgCycle);
        
        const today = new Date();
        today.setHours(0,0,0,0);
        nextDate.setHours(0,0,0,0);
        
        const daysUntilNext = Math.ceil((nextDate - today) / (1000 * 60 * 60 * 24));
        const formattedNextDate = formatDate(nextDate);

        // حساب موعد التبويض
        const ovuDate = new Date(lastDate);
        ovuDate.setDate(ovuDate.getDate() + (avgCycle - 14));
        ovuDate.setHours(0,0,0,0);
        const daysUntilOvu = Math.ceil((ovuDate - today) / (1000 * 60 * 60 * 24));
        const formattedOvuDate = formatDate(ovuDate);

        // 1. تنبيه التبويض والخصوبة (إذا كان اليوم أو قبله بيومين)
        if (daysUntilOvu >= -1 && daysUntilOvu <= 2) {
          notification = {
            active: true,
            type: 'ovulation_alert',
            days_left: daysUntilOvu,
            ovulation_date: formattedOvuDate,
            title_ar: `⭐ تنبيه نافذة التبويض والخصوبة (${formattedOvuDate})`,
            message_ar: `يا جميلة، أنتِ الآن في قمة نافذة الخصوبة والتبويض. استمتعي بنشاطكِ وإشراقتكِ، وتأكدي من شرب سوائل وفيرة 💕`,
            title_en: `⭐ Ovulation Window Alert (${formattedOvuDate})`,
            message_en: `You are currently in your peak fertile & ovulation window. Celebrate your high energy, glow, and stay well hydrated 💕`,
            checklist_ar: [
              'شرب 2-3 لتر ماء دافئ لترطيب الجسم',
              'ملاحظة إفرازات التبويض المطاطية الشفافة',
              'تناول أطعمة غنية بمضادات الأكسدة والخضراوات الورقية',
              'ممارسة رياضة خفيفة كالمشي أو اليوجا'
            ],
            checklist_en: [
              'Drink 2-3 liters of water to support hydration',
              'Monitor natural clear egg-white cervical fluid',
              'Eat antioxidant-rich berries and dark leafy greens',
              'Enjoy gentle movement like walking or stretching'
            ]
          };
        } 
        // 2. تنبيه الاستعداد المسبق قبل 5 أيام من الدورة
        else if (daysUntilNext <= 5 && daysUntilNext >= 0) {
          notification = {
            active: true,
            type: 'warning_prep',
            days_left: daysUntilNext,
            next_period_date: formattedNextDate,
            title_ar: `🌸 تنبيه استعداد: متبقي ${daysUntilNext} أيام على موعد دورتكِ القادمة (${formattedNextDate})`,
            message_ar: `يا قمر، دورتكِ الشهرية متوقعة خلال ${daysUntilNext} أيام. حان وقت أخذ الاحتياطات اللطيفة وتجهيز الفوط الصحية والمسكنات المريحة 💕`,
            title_en: `🌸 Period Alert: Expected in ${daysUntilNext} days (${formattedNextDate})`,
            message_en: `Your period is expected in ${daysUntilNext} days. Time to prepare your sanitary pads, comfy clothing, and pain relief essentials 💕`,
            checklist_ar: [
              'تجهيز الفوط الصحية القطنية وحفظها في حقيبتكِ',
              'توفير مشروبات دافئة (قرفة، نعناع، زنجبيل)',
              'التأكد من توفر مسكن خفيف (إيبوبروفين أو بنادول)',
              'تجهيز قربة ماء دافئ أو كمادات للبطن',
              'أخذ قسط كافٍ من النوم والترطيب بشرب الماء'
            ],
            checklist_en: [
              'Stock up and pack comfortable sanitary pads in your bag',
              'Keep warm herbal teas ready (cinnamon, peppermint, ginger)',
              'Have gentle pain relief available (Ibuprofen / Panadol)',
              'Prepare a warm heating pad for soothing comfort',
              'Stay well hydrated and get extra relaxing sleep'
            ]
          };
        }
      }
    }

    res.json({ success: true, notification });
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
});

// ==========================================
// 📊 APIs سجلات وتحليلات الدورة المتطورة (Smart Predictive Analytics)
// ==========================================

app.get('/api/my/cycles', authenticateToken, async (req, res) => {
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
});

app.get('/api/my/analytics', authenticateToken, async (req, res) => {
  try {
    const username = req.user.username;
    
    const userRes = await pool.query('SELECT * FROM users WHERE LOWER(username) = LOWER($1)', [username]);
    const user = userRes.rows[0] || { username: username, display_name: username, default_cycle_length: 28, default_period_length: 5 };

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
    let irregularAdvice = null;

    if (totalCycles > 0) {
      latestCycle = cycles[0];

      // حساب المتوسط المرجح الذكي (Weighted Moving Average) - إعطاء وزن أكبر للدورات الأحدث
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

      // حساب انتظام الدورة (Standard Deviation & Regularity Analysis)
      if (totalCycles >= 2) {
        const diffs = cycles.map(c => Math.pow((parseInt(c.cycle_length) || 28) - avgCycle, 2));
        const varianceVal = diffs.reduce((a, b) => a + b, 0) / totalCycles;
        const stdDev = Math.sqrt(varianceVal);
        variance = parseFloat(stdDev.toFixed(1));

        // إذا كان التباين أكبر من 3.5 أيام أو الدورة أقل من 21 أو أكبر من 36 يوماً
        if (stdDev > 3.5 || avgCycle < 21 || avgCycle > 36) {
          isRegular = false;
          irregularAdvice = {
            status: 'irregular',
            std_dev: variance,
            headline_ar: '🌸 ملاحظة: هناك تفاوت خفيف في طول دوراتكِ الشهرية',
            headline_en: '🌸 Note: Some variance detected in your cycle lengths',
            support_ar: 'لا تقلقي يا جميلة 💕 التفاوت في طول الدورة أمر طبيعي وشائع جداً بتأثير التوتر أو تغير نمط النوم أو الوزن. إليكِ نصائح التوازن:',
            support_en: 'Do not worry sweetie 💕 Cycle length variance is very common due to stress, sleep changes, or body weight. Here is gentle balance support:',
            tips_ar: [
              'تناول دهون صحية ومغنيسيوم (أفوكادو، مكسرات، شوكولاتة داكنة)',
              'شرب مشروب النعناع والقرفة يومياً لتهدئة الهرمونات',
              'الحرص على النوم 7-8 ساعات بانتظام لضبط الغدة النخامية',
              'تقليل السكريات المكررة والتوتر'
            ],
            tips_en: [
              'Incorporate healthy fats & magnesium (avocado, raw nuts, dark cocoa)',
              'Sip spearmint & cinnamon herbal tea daily to balance hormones',
              'Maintain a 7-8 hour sleep schedule to support the pituitary gland',
              'Reduce refined sugars and take gentle relaxation breaks'
            ]
          };
        }
      }

      const lastDate = new Date(latestCycle.last_period_date);
      if (!isNaN(lastDate.getTime())) {
        const nextDate = new Date(lastDate);
        nextDate.setDate(nextDate.getDate() + avgCycle);
        nextPeriodDate = formatDate(nextDate);

        const today = new Date();
        today.setHours(0,0,0,0);
        nextDate.setHours(0,0,0,0);
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
      irregular_advice: irregularAdvice,
      recent_cycles: cycles.slice(0, 10),
      all_cycles: cycles
    });
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
});

// إضافة دورة مع كمية النزيف وأعراض التبويض والألم
app.post('/api/my/cycles', authenticateToken, async (req, res) => {
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
      return res.status(400).json({ success: false, error: 'يرجى تزويد التاريخ وطول الدورة ومدة الحيض' });
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
      RETURNING *`;
      
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
});

app.delete('/api/my/cycles/:id', authenticateToken, async (req, res) => {
  try {
    const username = req.user.username;
    const { id } = req.params;
    
    const delResult = await pool.query(
      'DELETE FROM cycle_data WHERE id = $1 AND LOWER(user_id) = LOWER($2) RETURNING id',
      [id, username]
    );

    if (delResult.rows.length === 0) {
      return res.status(404).json({ success: false, error: 'السجل غير موجود أو لا تملكين صلاحية حذفه' });
    }

    res.json({ success: true, message: `تم حذف السجل بنجاح / Record deleted successfully` });
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
});

// 💬 API للشات الذكي واللطيف (Empathetic Health Assistant)
app.post('/api/chat', authenticateToken, async (req, res) => {
  try {
    const username = req.user.username;
    const { 
      message, 
      lang, 
      last_period_date, 
      cycle_length, 
      period_length, 
      pain_level, 
      pain_locations, 
      flow_intensity,
      ovulation_symptoms 
    } = req.body;
    
    console.log(`📩 [شات من ${username}]:`, message, `[Language: ${lang}]`);

    const clientLang = ['en', 'ar', 'fr', 'de', 'sw'].includes(lang) ? lang : 'ar';
    const displayName = req.user.display_name || username;

    const direct = parseCycleData(message || "");
    const { aiReply } = await processWithAI(message || "", clientLang, displayName);

    let savedRecord = null;

    if (direct.date || direct.cycleLength || last_period_date) {
      const finalDate = last_period_date || direct.date || new Date().toISOString().split('T')[0];
      const finalCycleLength = cycle_length ? parseInt(cycle_length) : (direct.cycleLength || 28);
      const finalPeriodLength = period_length ? parseInt(period_length) : (direct.periodLength || 5);
      const finalPainLevel = pain_level || direct.painLevel || 5;
      const finalLocations = pain_locations || direct.painLocations || null;
      const finalFlow = flow_intensity || direct.flowIntensity || 'medium';
      const finalOvu = ovulation_symptoms || direct.ovulationSymptoms || null;
      const finalFatigue = direct.fatigueLevel || 5;

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
          ovulation_symptoms
        ) 
        VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9) 
        RETURNING *`;
        
      const dbResult = await pool.query(insertQuery, [
        username,
        finalDate,
        finalCycleLength,
        finalPeriodLength,
        finalPainLevel,
        finalLocations,
        finalFatigue,
        finalFlow,
        finalOvu
      ]);

      savedRecord = dbResult.rows[0];
      savedRecord.last_period_date = formatDate(savedRecord.last_period_date);
    }

    res.json({
      success: true,
      ai_reply: aiReply,
      saved_record: savedRecord
    });
  } catch (error) {
    console.error('❌ خطأ في معالجة الشات:', error.message);
    res.status(500).json({ success: false, error: error.message });
  }
});

// API لمعلومات الاتصال بالشبكة المحلية ومشاركة التطبيق
app.get('/api/network-info', (req, res) => {
  const os = require('os');
  const interfaces = os.networkInterfaces();
  const addresses = [];
  for (const k in interfaces) {
    for (const k2 in interfaces[k]) {
      const address = interfaces[k][k2];
      if (address.family === 'IPv4' && !address.internal) {
        addresses.push({ ip: address.address, name: k });
      }
    }
  }
  res.json({
    success: true,
    port: PORT,
    local_url: `http://localhost:${PORT}`,
    network_urls: addresses.map(a => `http://${a.ip}:${PORT}`)
  });
});

// Catch-all route to serve index.html from client production build
app.use((req, res) => {
  const distPath1 = path.join(__dirname, '../client/dist/index.html');
  const distPath2 = path.join(__dirname, 'client/dist/index.html');
  
  if (fs.existsSync(distPath1)) {
    res.sendFile(distPath1);
  } else if (fs.existsSync(distPath2)) {
    res.sendFile(distPath2);
  } else {
    res.sendFile(path.join(__dirname, 'client/index.html'));
  }
});

// تشغيل السيرفر
const PORT = process.env.PORT || 3000;
pool.connect(async (err) => {
  if (err) {
    console.error('❌ فشل الاتصال بقاعدة البيانات SAFE:', err.message);
  } else {
    console.log('✅ تم الاتصال بنجاح بقاعدة البيانات SAFE');
    await initDb();
  }
});

app.listen(PORT, '0.0.0.0', () => {
  console.log(`🚀 خادم SAFE المستقل يعمل ومتاح لجميع الأجهزة:`);
  console.log(`   ➜ محلياً:    http://localhost:${PORT}`);
  console.log(`   ➜ على الشبكة: http://192.168.1.20:${PORT}`);
});
