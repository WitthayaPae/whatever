package com.ran.emu;

//  RAN EMU start page (emulator test app only, never shipped; built by build-emu.sh).
//  Pick the character and options, press Start: this writes <files>/emu.ini, which the
//  native side reads (ran_app.cpp EmuReadIni), and starts the game in its own process
//  (":game" in the emu manifest). A game already running is ended first, so every
//  Start is a clean emulator with the new character.

import android.app.Activity;
import android.app.ActivityManager;
import android.content.Context;
import android.content.Intent;
import android.graphics.Color;
import android.os.Bundle;
import android.os.Process;
import android.view.Gravity;
import android.view.View;
import android.view.ViewGroup;
import android.widget.ArrayAdapter;
import android.widget.Button;
import android.widget.CheckBox;
import android.widget.EditText;
import android.widget.LinearLayout;
import android.widget.RadioButton;
import android.widget.RadioGroup;
import android.widget.ScrollView;
import android.widget.Spinner;
import android.widget.TextView;

import java.io.BufferedReader;
import java.io.File;
import java.io.FileReader;
import java.io.FileWriter;
import java.util.ArrayList;
import java.util.Arrays;
import java.util.HashMap;
import java.util.List;
import java.util.Map;

public class EmuPicker extends Activity {
    //  class charset index (class<school><index>.charset) and its label
    static final String[] CLASS_IDX = { "0", "6", "1", "7", "8", "2", "9", "3", "A", "B" };
    static final String[] CLASS_NAME = {
        "Brawler M (หมัด ช)", "Brawler W (หมัด ญ)", "Swordsman M (ดาบ ช)", "Swordsman W (ดาบ ญ)",
        "Archer M (ธนู ช)", "Archer W (ธนู ญ)", "Shaman M (เวท ช)", "Shaman W (เวท ญ)",
        "Gunner M (ปืน ช)", "Gunner W (ปืน ญ)" };
    static final String[] SCHOOL = { "SG", "MP", "PHX" };

    File dir, ini;
    RadioButton rbClass, rbTest;
    Spinner spClass, spSchool, spTest;
    EditText etName, etLevel;
    RadioButton rbMaster, rbPlayer;
    CheckBox cbMaxLevel, cbMaxStats, cbAllSkills, cbGold, cbContrib, cbActivity;
    List<String> tests = new ArrayList<>();

    @Override protected void onCreate(Bundle b) {
        super.onCreate(b);
        dir = getExternalFilesDir(null);
        ini = new File(dir, "emu.ini");
        File[] fs = new File(dir, "emutest").listFiles();
        if (fs != null) {
            for (File f : fs) if (f.getName().endsWith(".charset")) tests.add(f.getName().replace(".charset", ""));
            java.util.Collections.sort(tests);
        }
        setContentView(build());
        load();
    }

    View build() {
        int pad = dp(12);
        ScrollView sv = new ScrollView(this);
        sv.setBackgroundColor(Color.rgb(18, 16, 12));
        LinearLayout root = new LinearLayout(this);
        root.setOrientation(LinearLayout.VERTICAL);
        root.setPadding(dp(24), pad, dp(24), pad);
        sv.addView(root);

        TextView title = text("RAN EMU", 22, Color.rgb(246, 215, 122));
        root.addView(title);
        root.addView(text("Emulator test app: no login, no server, your current CLIENT data.", 13, Color.LTGRAY));

        LinearLayout cols = new LinearLayout(this);
        cols.setOrientation(LinearLayout.HORIZONTAL);
        root.addView(cols);
        LinearLayout left = column(), right = column();
        cols.addView(left, new LinearLayout.LayoutParams(0, ViewGroup.LayoutParams.WRAP_CONTENT, 1));
        cols.addView(right, new LinearLayout.LayoutParams(0, ViewGroup.LayoutParams.WRAP_CONTENT, 1));

        //  character: a class of a school, or a PK test character from emutest/
        left.addView(head("Character"));
        RadioGroup rg = new RadioGroup(this);
        rbClass = radio("New character of a class");
        rbTest = radio("Test character (emutest)");
        rg.addView(rbClass); rg.addView(rbTest);
        left.addView(rg);
        left.addView(text("Class", 13, Color.LTGRAY));
        spClass = spinner(Arrays.asList(CLASS_NAME)); left.addView(spClass);
        left.addView(text("School", 13, Color.LTGRAY));
        spSchool = spinner(Arrays.asList(SCHOOL)); left.addView(spSchool);
        left.addView(text("Test character", 13, Color.LTGRAY));
        spTest = spinner(tests.isEmpty() ? Arrays.asList("(none in emutest/)") : tests); left.addView(spTest);
        left.addView(text("Name", 13, Color.LTGRAY));
        etName = new EditText(this); etName.setSingleLine(); etName.setTextColor(Color.WHITE); left.addView(etName);

        right.addView(head("Account"));
        RadioGroup rg2 = new RadioGroup(this);
        rbMaster = radio("GM master (GM window, / commands)");
        rbPlayer = radio("Normal player");
        rg2.addView(rbMaster); rg2.addView(rbPlayer);
        right.addView(rg2);
        right.addView(head("Level"));
        LinearLayout lv = new LinearLayout(this);
        lv.setOrientation(LinearLayout.HORIZONTAL);
        etLevel = new EditText(this); etLevel.setSingleLine(); etLevel.setTextColor(Color.WHITE);
        etLevel.setInputType(android.text.InputType.TYPE_CLASS_NUMBER); etLevel.setHint("charset's");
        etLevel.setHintTextColor(Color.GRAY); etLevel.setEms(5);
        lv.addView(etLevel);
        for (final String n : new String[] { "150", "175", "Clear" }) {
            Button bt = new Button(this); bt.setText(n);
            bt.setOnClickListener(new View.OnClickListener() { public void onClick(View v) { etLevel.setText(n.equals("Clear") ? "" : n); } });
            lv.addView(bt);
        }
        right.addView(lv);
        right.addView(head("Options"));
        cbMaxLevel = new CheckBox(this);   //  kept for old emu.ini files; level box above replaces it
        cbMaxStats = check("Max stats (50000 each)"); right.addView(cbMaxStats);
        cbAllSkills = check("All skills of the class"); right.addView(cbAllSkills);
        cbGold = check("1,000,000,000 gold"); right.addView(cbGold);
        cbContrib = check("100,000 contribution"); right.addView(cbContrib);
        cbActivity = check("100,000 activity points"); right.addView(cbActivity);

        Button start = new Button(this);
        start.setText("Start");
        start.setTextSize(20);
        start.setOnClickListener(new View.OnClickListener() { public void onClick(View v) { start(); } });
        LinearLayout.LayoutParams lp = new LinearLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, dp(56));
        lp.topMargin = dp(12);
        root.addView(start, lp);
        root.addView(text("Data: " + dir, 11, Color.GRAY));
        return sv;
    }

    //  last choice back from emu.ini
    void load() {
        Map<String, String> m = new HashMap<>();
        try (BufferedReader r = new BufferedReader(new FileReader(ini))) {
            String l; while ((l = r.readLine()) != null) { int i = l.indexOf('='); if (i > 0 && !l.startsWith("#")) m.put(l.substring(0, i).trim(), l.substring(i + 1).trim()); }
        } catch (Exception e) { }
        String cs = m.containsKey("charset") ? m.get("charset") : "class00.charset";
        java.util.regex.Matcher mm = java.util.regex.Pattern.compile("^class([0-2])([0-9A-Ha-h])\\.charset$").matcher(cs);
        if (mm.find()) {
            rbClass.setChecked(true);
            spSchool.setSelection(Integer.parseInt(mm.group(1)));
            int k = Arrays.asList(CLASS_IDX).indexOf(mm.group(2).toUpperCase());
            if (k >= 0) spClass.setSelection(k);
        } else {
            rbTest.setChecked(true);
            int k = tests.indexOf(cs.replace(".charset", ""));
            if (k >= 0) spTest.setSelection(k);
        }
        etName.setText(m.containsKey("name") ? m.get("name") : "Admin");
        if ("0".equals(m.get("userlevel"))) rbPlayer.setChecked(true); else rbMaster.setChecked(true);
        cbMaxLevel.setChecked(false);
        etLevel.setText(m.containsKey("level") && !"0".equals(m.get("level")) ? m.get("level") : "");
        cbMaxStats.setChecked("1".equals(m.get("maxstats")));
        cbAllSkills.setChecked("1".equals(m.get("allskills")));
        cbGold.setChecked("1".equals(m.get("gold")));
        cbContrib.setChecked("1".equals(m.get("contrib")));
        cbActivity.setChecked("1".equals(m.get("activity")));
    }

    void start() {
        String cs;
        if (rbTest.isChecked() && !tests.isEmpty()) cs = tests.get(spTest.getSelectedItemPosition());
        else cs = "class" + spSchool.getSelectedItemPosition() + CLASS_IDX[spClass.getSelectedItemPosition()] + ".charset";
        String name = etName.getText().toString().trim();
        if (name.isEmpty()) name = "Admin";
        try (FileWriter w = new FileWriter(ini)) {
            w.write("# written by the RAN EMU start page\n");
            w.write("charset=" + cs + "\n");
            w.write("name=" + name + "\n");
            w.write("userlevel=" + (rbPlayer.isChecked() ? "0" : "30") + "\n");
            String lvl = etLevel.getText().toString().trim();
            w.write("level=" + (lvl.isEmpty() ? "0" : lvl) + "\n");
            w.write("maxlevel=0\nmaxstats=" + b(cbMaxStats) + "\nallskills=" + b(cbAllSkills) + "\n");
            w.write("gold=" + b(cbGold) + "\ncontrib=" + b(cbContrib) + "\nactivity=" + b(cbActivity) + "\n");
        } catch (Exception e) {
            android.widget.Toast.makeText(this, "Cannot write " + ini + ": " + e, android.widget.Toast.LENGTH_LONG).show();
            return;
        }
        //  end a game that is still running, so the new character starts in a clean process
        ActivityManager am = (ActivityManager) getSystemService(Context.ACTIVITY_SERVICE);
        if (am != null && am.getRunningAppProcesses() != null)
            for (ActivityManager.RunningAppProcessInfo p : am.getRunningAppProcesses())
                if (p.processName.endsWith(":game")) Process.killProcess(p.pid);
        Intent i = new Intent();
        i.setClassName(this, "com.ran.launcher.RanActivity");
        i.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK | Intent.FLAG_ACTIVITY_CLEAR_TASK);
        startActivity(i);
    }

    static String b(CheckBox c) { return c.isChecked() ? "1" : "0"; }
    int dp(int v) { return (int) (v * getResources().getDisplayMetrics().density + 0.5f); }
    LinearLayout column() { LinearLayout l = new LinearLayout(this); l.setOrientation(LinearLayout.VERTICAL); l.setPadding(dp(8), 0, dp(8), 0); return l; }
    TextView text(String s, int sp, int c) { TextView t = new TextView(this); t.setText(s); t.setTextSize(sp); t.setTextColor(c); return t; }
    TextView head(String s) { TextView t = text(s, 16, Color.rgb(212, 166, 58)); t.setPadding(0, dp(10), 0, dp(2)); return t; }
    RadioButton radio(String s) { RadioButton r = new RadioButton(this); r.setText(s); r.setTextColor(Color.WHITE); r.setId(View.generateViewId()); return r; }
    CheckBox check(String s) { CheckBox c = new CheckBox(this); c.setText(s); c.setTextColor(Color.WHITE); return c; }
    Spinner spinner(List<String> items) {
        Spinner s = new Spinner(this);
        ArrayAdapter<String> a = new ArrayAdapter<>(this, android.R.layout.simple_spinner_item, items);
        a.setDropDownViewResource(android.R.layout.simple_spinner_dropdown_item);
        s.setAdapter(a);
        return s;
    }
}
