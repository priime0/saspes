/**
 *
 * @copyright Copyright (c) 2018-2020 Gary Kim <gary@garykim.dev>
 * @copyright Copyright (c) 2020 Suhas Hariharan <contact@suhas.net>
 * @author Gary Kim <gary@garykim.dev>
 *
 * @license GNU AGPL version 3 only
 *
 * SAS Powerschool Enhancement Suite - A browser extension to improve the experience of SAS Powerschool.
 *
 * This program is free software: you can redistribute it and/or modify
 * it under the terms of the GNU Affero General Public License as
 * published by the Free Software Foundation, version 3.
 *
 * This program is distributed in the hope that it will be useful,
 * but WITHOUT ANY WARRANTY; without even the implied warranty of
 * MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE.  See the
 * GNU Affero General Public License for more details.
 *
 * You should have received a copy of the GNU Affero General Public License
 * along with this program.  If not, see <https://www.gnu.org/licenses/>.
 *
 */

'use strict';

import Assignment from "./models/Assignment";
import Course from './models/Course';
import browser from 'webextension-polyfill';
const getKeyRange = require('get-key-range');

const grade_gpa = {
    'A+': 4.5,
    'A': 4.0,
    'B+': 3.5,
    'B': 3.0,
    'C+': 2.5,
    'C': 2.0,
    'D+': 1.5,
    'D': 1.0,
    'F': 0.0,
};

/**
 * Will convert a given grade into its corresponding SAS Grade Point Average.
 * @param {string} grade The grade to convert.
 * @returns {number} The corresponding grade point average.
 */
function gradeToGPA (grade) {
    if (grade in grade_gpa) {
        return grade_gpa[grade];
    }
    return -1;
}

const grade_fp = {
    'A+': 90,
    'A': 80,
    'B+': 70,
    'B': 60,
    'C+': 50,
    'C': 40,
    'D+': 30,
    'D': 20,
    'F': 10,
};

/**
 * gradeToFP will convert a given grade to its corresponding final percent.
 * @param {string} grade The grade to convert.
 * @returns {number} The corresponding final percent.
 */
function gradeToFP (grade) {
    if (grade in grade_fp) {
        return grade_fp[grade];
    }
    return -1;
}

const avaliableGrades = ["A+", "A", "B+", "B", "C+", "C", "D+", "D", "F"];

const fprange = {
    '85-90': 'A+',
    '75-85': 'A',
    '65-75': 'B+',
    '55-65': 'B',
    '45-55': 'C+',
    '35-45': 'C',
    '25-35': 'D+',
    '15-25': 'D',
    '0-15': 'F',
};

function fpToGrade (finalPercent) {
    return getKeyRange(fprange, parseFloat(parseFloat(finalPercent).toFixed(2)));
}

/**
 * Calculates the grade point average with the given courses.
 * @param {Course[]} courses The courses for which the overall grade point average should be calculated.
 * @returns {string} The grade point average to the hundredth place.
 */
function calculate_gpa (courses) {
    let courses_with_grades = 0;
    let sum = 0;
    for (var i = 0; i < courses.length; i++) {
        if (gradeToGPA(courses[i].grade) !== -1) {
            const multiplier = calculate_credit_hours(courses[i].name);
            courses_with_grades += multiplier;
            sum += multiplier * (gradeToGPA(courses[i].grade) + course_boost(courses[i].name, courses[i].grade));
        }
    }
    if (courses_with_grades === 0) {
        return '0.00';
    }
    return (sum / courses_with_grades).toFixed(2);

    function course_boost (course_name, grade) {
        if (gradeToGPA(grade) < 1.8) {
            return 0;
        }
        if (/^(AP |AT )/.test(course_name)) {
            return 0.5;
        }
        return 0;
    }
}

function calculate_credit_hours (course_name) {
    const double_effect_courses = [`English 10/American History`, `English 9/World History`];
    if (double_effect_courses.includes(course_name)) {
        return 2;
    }
    if (/^(I Service: |IS: )/.test(course_name)) {
        return 0.5;
    }
    return 1;
}

/**
 * Extract the final percent from the course page html.
 * @param {String} html course page html
 * @returns {Number|undefined} The final percent
 */
function extractFinalPercent (html) {
    let number;
    try {
        let current_string = html.match(/(?=document\.write).*/g)[1];
        current_string = /\[.*\]/g.exec(current_string)[0].slice(1, -1);
        const temp = current_string.split(";");
        number = Math.max(isNaN(temp[temp.length - 2]) ? -Infinity : parseFloat(temp[temp.length - 2]), isNaN(temp[temp.length - 1]) ? -Infinity : parseFloat(temp[temp.length - 1]));
    } catch (e) {
        return;
    }
    if (number === -Infinity) {
        return;
    }
    return number;
}

/**
 * Return Assignment instances for the given class page.
 * @param {Element} node Root node element of the class page.
 * @returns {Assignment[]} Assignments in this course
 */
function assignments (node) {
    const tr = [];
    // Find assignments table, get it's rows, take out the header and legend rows.
    [...node.querySelector('table[align=center').querySelectorAll('tr')].slice(1, -1).forEach((e, i) => {
        const curr = e.querySelectorAll('td');
        const assignment = new Assignment(curr[2]?.innerText || "", curr[curr.length - 1]?.innerText || "", i);
        if (e.querySelector('img[src="/images/icon_missing.gif"]')) {
            assignment.addStatus(Assignment.statuses.MISSING);
        }
        tr.push(assignment);
    });
    return tr;
}

/**
 * Return saved grades for specified username.
 * @async
 * @param {String} username users full name
 * @returns {Promise<Course[]>} list of courses objects for that user
 */
async function getSavedGrades (username) {
    const courses = [];
    const course_list = await browser.storage.local.get("USERDATA_" + username)
    if (output["USERDATA_" + username] !== undefined) {
        const course_list = output["USERDATA_" + username].courses || [];
        for (let i = 0; i < course_list.length; i++) {
            const course = course_list[i];
            courses.push(new Course(course.name, course.link, course.grade, course.finalPercent, course.assignments));
        }
        return course_list;
    }
}

/**
 * Saves grades for user to browser local storage
 * @async
 * @param {String} username users full name
 * @param {Course[]} courses list of course objects to save
 */
async function saveGradesLocally (username, courses) {
    const user_data = {};
    const course_list = [];
    for (let i = 0; i < courses.length; i++) {
        course_list.push(courses[i].toObject());
    }
    user_data["USERDATA_" + username] = { "courses": course_list };
    user_data.most_recent_user = username;
    browser.storage.local.set(user_data);
}

/**
 * Send Analytics ping
 * @param {String} action_input the action being taken
 * @param {String} [url] Url to report. Defaults to the current page in the browser
 */
async function analytics_message (action_input, url) {
    const href = url || window.location.href.split("?")[0];
    browser.runtime.sendMessage({ action: "analytics_send", args: { url: href, action: action_input } });
}

export {
    gradeToFP,
    grade_fp,
    avaliableGrades,
    fprange,
    fpToGrade,
    gradeToGPA,
    calculate_gpa,
    extractFinalPercent,
    assignments,
    calculate_credit_hours,
    analytics_message,
    getSavedGrades,
    saveGradesLocally,
};
