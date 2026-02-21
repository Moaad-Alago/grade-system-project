const express = require("express");
const cors = require("cors");
const { createClient } = require("redis");
require("dotenv").config();

const app = express();
app.use(cors());
app.use(express.urlencoded({ extended: true }));
app.use(express.json());

const PORT = Number(process.env.PORT || 3000);
const REDIS_URL = process.env.REDIS_URL;
const REDIS_KEY = "grade_system:data";

if (!REDIS_URL) {
  console.error("Missing REDIS_URL in .env");
  process.exit(1);
}

/**
 * System-defined courses (fixed)
 */
const courses = {
  math: { name: "Math", components: { exam: 80, homework: 20 } },
  programming: { name: "Programming", components: { exam: 40, project: 40, homework: 20 } },
  web_development: { name: "Web Development", components: { project: 80, homework: 20 } }
};

const redisClient = createClient({
  url: REDIS_URL
});

redisClient.on("error", (err) => {
  console.error("Redis Client Error:", err);
});

/* ---------- Helpers ---------- */
function sanitizeStudents(students) {
  return (Array.isArray(students) ? students : [])
    .filter((s) => s && typeof s === "object")
    .map((s) => ({
      name: String(s.name || "").trim(),
      id: String(s.id || "").trim(),
      courses: Array.isArray(s.courses)
        ? s.courses
            .filter((c) => c && typeof c === "object")
            .map((c) => ({
              courseName: String(c.courseName || "").trim(),
              grade: String(c.grade ?? "").trim(),
              status: String(c.status || "").trim()
            }))
            .filter((c) => c.courseName && c.grade !== "" && c.status)
        : []
    }))
    .filter((s) => s.name && s.id);
}

async function readData() {
  try {
    const raw = await redisClient.get(REDIS_KEY);

    if (!raw) return { students: [] };

    const parsed = JSON.parse(raw);

    // دعم الشكل القديم لو كان Array
    if (Array.isArray(parsed)) {
      return { students: sanitizeStudents(parsed) };
    }

    if (!parsed || typeof parsed !== "object") {
      return { students: [] };
    }

    return {
      students: sanitizeStudents(parsed.students)
    };
  } catch (err) {
    console.error("readData error:", err);
    return { students: [] };
  }
}

async function writeData(data) {
  const safeData = {
    students: sanitizeStudents(data?.students || [])
  };

  await redisClient.set(REDIS_KEY, JSON.stringify(safeData, null, 2));
}

async function getStudents() {
  const data = await readData();
  return data.students;
}

async function saveStudent(studentRecord) {
  const data = await readData();

  const existingStudent = data.students.find(
    (s) => String(s.id) === String(studentRecord.id)
  );

  if (existingStudent) {
    const existingCourse = existingStudent.courses.find(
      (c) => String(c.courseName).trim().toLowerCase() === String(studentRecord.course).trim().toLowerCase()
    );

    if (existingCourse) {
      throw new Error("Student already has a grade for this course");
    }

    existingStudent.courses.push({
      courseName: studentRecord.course,
      grade: studentRecord.grade,
      status: studentRecord.status
    });
  } else {
    data.students.push({
      name: studentRecord.name,
      id: String(studentRecord.id),
      courses: [
        {
          courseName: studentRecord.course,
          grade: studentRecord.grade,
          status: studentRecord.status
        }
      ]
    });
  }

  await writeData(data);
}

function normalizeStatus(status) {
  const value = String(status || "").trim().toLowerCase();
  if (!value) return null;
  if (value === "passed" || value === "pass") return "Passed";
  if (value === "failed" || value === "fail") return "Failed";
  return null;
}

function calculateFinalGrade(courseKey, gradesInput) {
  const selectedCourse = courses[courseKey];
  if (!selectedCourse) throw new Error("Invalid course");

  let finalGrade = 0;

  for (const component of Object.keys(selectedCourse.components)) {
    const weight = Number(selectedCourse.components[component]);
    const value = Number(gradesInput[component]);

    if (Number.isNaN(value) || value < 0 || value > 100) {
      throw new Error(`Invalid ${component} grade`);
    }

    finalGrade += value * (weight / 100);
  }

  return finalGrade;
}

function findCourseKeyByCourseName(courseName) {
  const lower = String(courseName || "").trim().toLowerCase();
  return Object.keys(courses).find(
    (key) => String(courses[key].name).trim().toLowerCase() === lower
  );
}

/* ---------- Routes ---------- */

app.get("/", (req, res) => {
  res.json({ status: "Backend is running (Redis)" });
});

app.get("/api/courses", (req, res) => {
  res.json(courses);
});

app.get("/api/students", async (req, res) => {
  try {
    const { id, searchById, status } = req.query;
    let students = await getStudents();

    const searchId = String(searchById || id || "").trim();
    if (searchId) {
      students = students.filter((s) => String(s.id).includes(searchId));
    }

    const normalized = normalizeStatus(status);
    if (status && !normalized) {
      return res.status(400).json({ error: "Invalid status filter. Use Passed or Failed" });
    }

    if (normalized) {
      students = students
        .map((s) => ({
          ...s,
          courses: (s.courses || []).filter(
            (c) => String(c.status).toLowerCase() === normalized.toLowerCase()
          )
        }))
        .filter((s) => s.courses.length > 0);
    }

    res.json(students);
  } catch (err) {
    console.error("GET /api/students error:", err);
    res.status(500).json({ error: "Server error while loading students" });
  }
});

app.delete("/api/students/:id", async (req, res) => {
  try {
    const studentId = String(req.params.id);
    const data = await readData();

    const before = data.students.length;
    data.students = data.students.filter((s) => String(s.id) !== studentId);

    if (data.students.length === before) {
      return res.status(404).json({ error: "Student not found" });
    }

    await writeData(data);
    res.json({ message: "Student deleted successfully" });
  } catch (err) {
    console.error("DELETE student error:", err);
    res.status(500).json({ error: "Server error while deleting student" });
  }
});

app.delete("/api/students/:id/courses/:courseName", async (req, res) => {
  try {
    const studentId = String(req.params.id);
    const courseName = decodeURIComponent(String(req.params.courseName)).trim().toLowerCase();

    const data = await readData();
    const student = data.students.find((s) => String(s.id) === studentId);

    if (!student) {
      return res.status(404).json({ error: "Student not found" });
    }

    const beforeCourses = student.courses.length;
    student.courses = student.courses.filter(
      (c) => String(c.courseName).trim().toLowerCase() !== courseName
    );

    if (student.courses.length === beforeCourses) {
      return res.status(404).json({ error: "Course not found for this student" });
    }

    if (student.courses.length === 0) {
      data.students = data.students.filter((s) => String(s.id) !== studentId);
    }

    await writeData(data);
    res.json({ message: "Course deleted successfully" });
  } catch (err) {
    console.error("DELETE course error:", err);
    res.status(500).json({ error: "Server error while deleting course" });
  }
});

app.put("/api/students/:id/courses/:courseName", async (req, res) => {
  try {
    const studentId = String(req.params.id);
    const courseNameParam = decodeURIComponent(String(req.params.courseName))
      .trim()
      .toLowerCase();

    const data = await readData();
    const student = data.students.find((s) => String(s.id) === studentId);

    if (!student) {
      return res.status(404).json({ error: "Student not found" });
    }

    const courseEntry = student.courses.find(
      (c) => String(c.courseName).trim().toLowerCase() === courseNameParam
    );

    if (!courseEntry) {
      return res.status(404).json({ error: "Course not found for this student" });
    }

    const courseKey = findCourseKeyByCourseName(courseEntry.courseName);
    if (!courseKey) {
      return res.status(400).json({ error: "Cannot update this course (unknown course type)" });
    }

    const selectedCourse = courses[courseKey];

    const incomingGrades = {};
    for (const component of Object.keys(selectedCourse.components)) {
      if (req.body[component] === undefined || req.body[component] === "") {
        return res.status(400).json({ error: `${component} grade is required` });
      }
      incomingGrades[component] = req.body[component];
    }

    const finalGrade = calculateFinalGrade(courseKey, incomingGrades);
    const status = finalGrade >= 60 ? "Passed" : "Failed";

    courseEntry.grade = finalGrade.toFixed(2);
    courseEntry.status = status;

    await writeData(data);

    res.json({
      message: "Grade updated successfully",
      updatedCourse: {
        courseName: courseEntry.courseName,
        grade: courseEntry.grade,
        status: courseEntry.status
      }
    });
  } catch (err) {
    console.error("PUT update course error:", err);

    if (String(err.message || "").startsWith("Invalid")) {
      return res.status(400).json({ error: err.message });
    }

    res.status(500).json({ error: "Server error while updating grade" });
  }
});

app.post("/api/calculate", async (req, res) => {
  try {
    const { studentName, studentId, course, exam, homework, project } = req.body;

    if (!studentName || !String(studentName).trim()) {
      return res.status(400).json({ error: "Student name is required" });
    }

    if (!studentId || !String(studentId).trim()) {
      return res.status(400).json({ error: "Student ID is required" });
    }

    if (!course) {
      return res.status(400).json({ error: "Course is required" });
    }

    if (!courses[course]) {
      return res.status(400).json({ error: "Invalid course" });
    }

    const selectedCourse = courses[course];
    const gradesInput = { exam, homework, project };

    for (const component of Object.keys(selectedCourse.components)) {
      const value = Number(gradesInput[component]);
      if (Number.isNaN(value) || value < 0 || value > 100) {
        return res.status(400).json({ error: `${component} grade must be between 0 and 100` });
      }
    }

    const finalGrade = calculateFinalGrade(course, gradesInput);
    const status = finalGrade >= 60 ? "Passed" : "Failed";

    const studentRecord = {
      name: String(studentName).trim(),
      id: String(studentId).trim(),
      course: selectedCourse.name,
      grade: finalGrade.toFixed(2),
      status
    };

    await saveStudent(studentRecord);

    res.json({ student: studentRecord });
  } catch (err) {
    console.error("POST /api/calculate error:", err);

    if (err.message === "Student already has a grade for this course") {
      return res.status(409).json({ error: err.message });
    }

    if (String(err.message || "").startsWith("Invalid")) {
      return res.status(400).json({ error: err.message });
    }

    res.status(500).json({ error: "Server error while saving grade" });
  }
});

/* ---------- Startup ---------- */
async function startServer() {
  try {
    await redisClient.connect();
    console.log("Connected to Redis ✅");

    // init data if empty
    const exists = await redisClient.get(REDIS_KEY);
    if (!exists) {
      await redisClient.set(REDIS_KEY, JSON.stringify({ students: [] }, null, 2));
      console.log("Initialized Redis data store ✅");
    }

    app.listen(PORT, () => {
      console.log(`Server running on http://localhost:${PORT}`);
    });
  } catch (err) {
    console.error("Failed to start server:", err);
    process.exit(1);
  }
}

startServer();